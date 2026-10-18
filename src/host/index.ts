/**
 * @local/dsh-deepseek-chat — Host 侧插件（TypeScript 源码）。
 *
 * 三个职责：
 *  1. 在 dsh web 的 HTTP 服务上注册 /dsh-deepseek-chat/config 路由，
 *     告诉客户端 iframe 该指向哪里。
 *  2. 启动一个仅监听 127.0.0.1 的 HTTP 反向代理，整域转发
 *     https://chat.deepseek.com：剥离阻止 iframe 嵌入的响应头
 *     （content-security-policy / x-frame-options 等），重写 Set-Cookie
 *     （去 Domain / Secure，适配 http loopback 与 Safari）与 Location，
 *     并改写字首屏 <script> 的属性（见 rewriteShellHtml）。其余响应体原样
 *     透传，SSE 流式逐块转发。
 *  3. 在 /dsh-deepseek-chat/activity 上提供 SSE，推送 DeepSeek 是否正在
 *     流式生成（见 createActivityHub）。
 *
 * 构建产物是 lib/index.js（ESM，node 内置模块保持外部引用）。
 */
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Cordis 插件标识，用于 Loader 诊断。 */
const name = 'deepseek-chat';

/** 配置路由需要 Web HTTP 注册表。 */
const inject = ['webServer'];

interface PluginConfig {
  /** 代理监听端口；默认 3377，被占用时自动回退到随机端口。 */
  port?: number;
  /** 上游站点，默认 https://chat.deepseek.com。 */
  target?: string;
}

interface WebServerRoute {
  kind: 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface WebServerService {
  register(route: WebServerRoute): unknown;
}

interface CordisContext {
  webServer: WebServerService;
  /** 注册清理回调；返回的 disposer 在插件卸载时执行。 */
  effect(fn: () => unknown, label?: string): unknown;
  /** 部分宿主带 logger，没有就静默。 */
  logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

const DEFAULT_TARGET = 'https://chat.deepseek.com';
const DEFAULT_PORT = 3377;

type UpstreamAgent = http.Agent | https.Agent;

/**
 * 上游连接池：keep-alive 复用 TLS 连接。会话列表、历史消息、SSE 补全都是
 * 小请求，不复用时每次转发都要重做一遍握手，开销会盖过传输本身。
 * 协议跟随 target：线上是 https，本地调试/测试可以指 http。
 */
function createUpstreamAgent(protocol: string): UpstreamAgent {
  const options = {
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: 32,
    maxFreeSockets: 8,
    timeout: 60_000,
    scheduling: 'lifo' as const,
  };
  return protocol === 'http:' ? new http.Agent(options) : new https.Agent(options);
}

/** 按目标协议选 http / https 模块。 */
function upstreamRequest(
  url: URL,
  options: http.RequestOptions,
  agent: UpstreamAgent,
  onResponse: (up: IncomingMessage) => void,
): http.ClientRequest {
  return url.protocol === 'http:'
    ? http.request(url, { ...options, agent: agent as http.Agent }, onResponse)
    : https.request(url, { ...options, agent: agent as https.Agent }, onResponse);
}

/** 逐跳头：转发前必须剥离（RFC 2616 §13.5.1）。 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** 会阻止 iframe 嵌入或跨源加载的响应头，代理时剥离。 */
const STRIP_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  // HSTS 绝不能透传：浏览器会把 127.0.0.1 整个 host（含 DSH 自身端口）
  // 升级到 https，代理与 GUI 会双双挂掉。
  'strict-transport-security',
]);

/**
 * 上游的 CSP 被整条剥掉了（否则 iframe 进不来），这里补回最小的一条：
 * 只允许本机页面嵌入。否则任何外部站点都能把 127.0.0.1 的代理塞进 iframe，
 * 拿到用户已登录的 chat.deepseek.com 做点击劫持——同源策略挡住了读数据，
 * 但挡不住 UI 覆盖。
 */
const FRAME_ANCESTORS = "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*";

/**
 * 去掉 shell HTML 里首屏 <script> 的 `crossorigin` 与 SRI `integrity`。
 * 这些脚本来自 CDN（fe-static.deepseek.com），而 CDN 只放行 deepseek.com 系的
 * Origin：页面搬到 127.0.0.1 后 CORS 校验必败、脚本报 onerror，SPA 显示
 * 「页面资源加载异常」。属性去掉后按普通跨源 classic script 加载，字节不变。
 * 后续 webpack chunk 用绝对 publicPath + 普通 script 标签加载，无需处理。
 */
function rewriteShellHtml(html: string): string {
  return html
    .replace(/\s+crossorigin(="[^"]*")?/g, '')
    .replace(/\s+integrity="[^"]*"/g, '');
}

/**
 * 重写 Set-Cookie：去掉 Domain（回落为代理 host 的 host-only cookie）、
 * 去掉 Secure（http loopback 下 Safari 不接受 Secure cookie）、去掉
 * Partitioned（避免 CHIPS 分区到 DSH 顶层站点）。其余属性原样保留。
 */
function rewriteSetCookie(value: string): string {
  const parts = value.split(';');
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    const attr = trimmed.split('=', 1)[0].toLowerCase();
    if (i === 0) {
      kept.push(trimmed); // name=value 本体
      continue;
    }
    if (attr === 'domain' || attr === 'secure' || attr === 'partitioned') continue;
    kept.push(trimmed);
  }
  return kept.join('; ');
}

/** 把指向上游 origin 的 Location 重定向改写到代理 origin。 */
function rewriteLocation(value: string, target: URL, proxyOrigin: string): string {
  if (value.startsWith(target.origin)) return proxyOrigin + value.slice(target.origin.length);
  return value;
}

/** SSE 心跳间隔：每 15s 一条注释行，让中间层知道连接还活着。 */
const HEARTBEAT_MS = 15_000;

/** 一帧状态事件：`data: {"streaming":true|false}` 后跟空行。 */
function stateFrame(streaming: boolean): string {
  return `data: ${JSON.stringify({ streaming })}\n\n`;
}

/**
 * 流式活动状态中枢：activeStreams 计数、/activity 的 SSE 订阅者与心跳。
 *
 * track() 打开一条流并返回一次性 release：计数 0→1 广播 streaming:true，
 * 1→0 广播 streaming:false；release 重复调用只减一次。
 */
interface ActivityHub {
  track(): () => void;
  subscribe(res: ServerResponse): void;
  dispose(): void;
}

function createActivityHub(): ActivityHub {
  let activeStreams = 0;
  const subscribers = new Set<ServerResponse>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const writeToAll = (chunk: string): void => {
    for (const res of subscribers) {
      if (res.writableEnded || res.destroyed) continue;
      res.write(chunk);
    }
  };

  const stopHeartbeat = (): void => {
    if (heartbeat === null) return;
    clearInterval(heartbeat);
    heartbeat = null;
  };

  const drop = (res: ServerResponse): void => {
    subscribers.delete(res);
    if (subscribers.size === 0) stopHeartbeat();
  };

  return {
    track() {
      activeStreams += 1;
      if (activeStreams === 1) writeToAll(stateFrame(true));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeStreams -= 1;
        if (activeStreams === 0) writeToAll(stateFrame(false));
      };
    },
    subscribe(res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      subscribers.add(res);
      res.write(stateFrame(activeStreams > 0));
      res.on('close', () => drop(res));
      res.on('error', () => drop(res));
      if (heartbeat === null) {
        heartbeat = setInterval(() => writeToAll(': ping\n\n'), HEARTBEAT_MS);
      }
    },
    dispose() {
      stopHeartbeat();
      for (const res of subscribers) {
        if (!res.writableEnded && !res.destroyed) res.end();
      }
      subscribers.clear();
    },
  };
}

/** 核心代理处理器：req/res 来自本地 server，经连接池转发到 target。 */
function proxyRequest(target: URL, agent: UpstreamAgent, proxyOrigin: string, activity: ActivityHub, req: IncomingMessage, res: ServerResponse): void {
  const upstreamUrl = new URL(req.url ?? '/', target);
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith('sec-fetch-')) continue; // 让上游看到普通导航语义
    if (lower === 'x-forwarded-for' || lower === 'x-forwarded-host' || lower === 'x-forwarded-proto' || lower === 'forwarded') continue;
    if (lower === 'host') continue;
    if (lower === 'origin') { headers['origin'] = target.origin; continue; }
    if (lower === 'referer') {
      headers['referer'] = String(value).startsWith(proxyOrigin)
        ? target.origin + String(value).slice(proxyOrigin.length)
        : target.origin + '/';
      continue;
    }
    headers[key] = value as string | string[];
  }
  headers['host'] = target.host;
  const wantsHtml = String(req.headers['accept'] ?? '').includes('text/html');
  if (wantsHtml) headers['accept-encoding'] = 'identity'; // HTML 可能要改写，勿压缩

  const upstream = upstreamRequest(upstreamUrl, { method: req.method, headers, timeout: 0 }, agent, (up) => {
    const contentType = String(up.headers['content-type'] ?? '');
    const release = contentType.startsWith('text/event-stream') ? activity.track() : null;
    if (release !== null) {
      // 上游结束或客户端断开都算这条流收尾；release 只生效一次。
      up.on('end', release);
      res.on('close', release);
    }

    // 上游中途断开时响应头可能已经发出，只能结束响应。没有这个监听，
    // IncomingMessage 的 'error' 会冒成未捕获异常，把宿主进程整个打挂。
    up.on('error', (error) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'upstream stream error' }));
        return;
      }
      res.destroy(error);
    });

    const outHeaders: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(up.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      if (STRIP_RESPONSE_HEADERS.has(lower)) continue;
      if (lower === 'location') {
        outHeaders['location'] = rewriteLocation(Array.isArray(value) ? value[0] : String(value), target, proxyOrigin);
        continue;
      }
      if (lower === 'set-cookie') {
        const list = Array.isArray(value) ? value : [String(value)];
        outHeaders['set-cookie'] = list.map(rewriteSetCookie);
        continue;
      }
      outHeaders[key] = value as string | string[];
    }
    outHeaders['content-security-policy'] = FRAME_ANCESTORS;
    const contentEncoding = String(up.headers['content-encoding'] ?? 'identity');
    if (contentType.startsWith('text/html') && (contentEncoding === 'identity' || contentEncoding === '')) {
      // shell HTML：缓冲改写（去掉 crossorigin/integrity），重算 content-length
      delete outHeaders['content-length'];
      const chunks: Buffer[] = [];
      up.on('data', (chunk: Buffer) => chunks.push(chunk));
      up.on('end', () => {
        const html = rewriteShellHtml(Buffer.concat(chunks).toString('utf8'));
        const body = Buffer.from(html, 'utf8');
        outHeaders['content-length'] = String(body.byteLength);
        res.writeHead(up.statusCode ?? 502, outHeaders);
        res.end(body);
      });
      return;
    }
    res.writeHead(up.statusCode ?? 502, outHeaders);
    up.pipe(res); // 逐块透传：SSE / 流式补全不缓冲
  });

  upstream.on('error', (error) => {
    if (res.destroyed) return;
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    res.end(JSON.stringify({ error: `upstream error: ${error.message}` }));
  });

  // 客户端先断开（切页 / 关标签）就别再往上游写了。aborted 在新 Node 上已弃用，
  // 且不覆盖所有断开路径；close + writableEnded 才准确。
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });

  req.pipe(upstream);
}

async function startProxy(config: PluginConfig, log: (msg: string) => void): Promise<{ server: http.Server; agent: UpstreamAgent; origin: string; activity: ActivityHub }> {
  const target = new URL(config.target ?? DEFAULT_TARGET);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`DeepSeek 代理只支持 http/https 目标，收到 ${target.protocol}`);
  }
  const agent = createUpstreamAgent(target.protocol);
  const activity = createActivityHub();
  let server: http.Server | null = null;
  let origin = '';

  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    const candidate = http.createServer();
    candidate.timeout = 0;             // SSE 长连接不设总超时
    candidate.requestTimeout = 0;
    candidate.headersTimeout = 60000;
    candidate.on('error', reject);
    candidate.listen(port, '127.0.0.1', () => {
      candidate.removeListener('error', reject);
      server = candidate;
      resolve((candidate.address() as { port: number }).port);
    });
  });

  let boundPort: number;
  try {
    boundPort = await listen(config.port ?? DEFAULT_PORT);
  } catch {
    boundPort = await listen(0); // 端口被占用：回退随机端口
    log(`[deepseek-chat] 端口 ${config.port ?? DEFAULT_PORT} 被占用，代理改用 ${boundPort}`);
  }
  origin = `http://127.0.0.1:${boundPort}`;

  // 关闭 Nagle：SSE / 流式补全的小分片立即下发，不等 40ms 聚合
  server!.on('connection', (socket) => socket.setNoDelay(true));
  server!.on('request', (req, res) => {
    try {
      proxyRequest(target, agent, origin, activity, req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  log(`[deepseek-chat] DeepSeek 网页版代理已启动：${origin} -> ${target.origin}`);
  return { server: server!, agent, origin, activity };
}

async function apply(ctx: CordisContext, config: PluginConfig = {}): Promise<void> {
  const log = (msg: string) => ctx.logger?.info(msg);

  const { server, agent, origin, activity } = await startProxy(config, log);
  ctx.effect(() => () => {
    activity.dispose();
    server.close();
    server.closeAllConnections?.();
    agent.destroy(); // 放空上游连接池
  }, 'deepseek-chat: upstream proxy');

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-deepseek-chat',
    handler: (req, res) => {
      // prefix 路由不剥离前缀：req.url 形如 /dsh-deepseek-chat/config
      const pathname = (req.url ?? '').split('?', 1)[0];
      if (req.method === 'GET' && (pathname === '/dsh-deepseek-chat' || pathname === '/dsh-deepseek-chat/' || pathname === '/dsh-deepseek-chat/config')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ url: origin + '/', target: config.target ?? DEFAULT_TARGET }));
        return;
      }
      if (req.method === 'GET' && pathname === '/dsh-deepseek-chat/activity') {
        activity.subscribe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not found' }));
    },
  }), 'deepseek-chat: config route');
}

export { apply, createActivityHub, inject, name };
