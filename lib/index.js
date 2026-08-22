// src/host/index.ts
import http from "node:http";
import https from "node:https";
var name = "deepseek-chat";
var inject = ["webServer"];
var DEFAULT_TARGET = "https://chat.deepseek.com";
var DEFAULT_PORT = 3377;
function createUpstreamAgent() {
  return new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 3e4,
    maxSockets: 32,
    maxFreeSockets: 8,
    timeout: 6e4,
    scheduling: "lifo"
  });
}
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var STRIP_RESPONSE_HEADERS = /* @__PURE__ */ new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  // HSTS 绝不能透传：浏览器会把 127.0.0.1 整个 host（含 DSH 自身端口）
  // 升级到 https，代理与 GUI 会双双挂掉。
  "strict-transport-security"
]);
function rewriteShellHtml(html) {
  return html.replace(/\s+crossorigin(="[^"]*")?/g, "").replace(/\s+integrity="[^"]*"/g, "");
}
function rewriteSetCookie(value) {
  const parts = value.split(";");
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    const attr = trimmed.split("=", 1)[0].toLowerCase();
    if (i === 0) {
      kept.push(trimmed);
      continue;
    }
    if (attr === "domain" || attr === "secure" || attr === "partitioned") continue;
    kept.push(trimmed);
  }
  return kept.join("; ");
}
function rewriteLocation(value, target, proxyOrigin) {
  if (value.startsWith(target.origin)) return proxyOrigin + value.slice(target.origin.length);
  return value;
}
function proxyRequest(target, agent, proxyOrigin, req, res) {
  const upstreamUrl = new URL(req.url ?? "/", target);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === void 0) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith("sec-fetch-")) continue;
    if (lower === "x-forwarded-for" || lower === "x-forwarded-host" || lower === "x-forwarded-proto" || lower === "forwarded") continue;
    if (lower === "host") continue;
    if (lower === "origin") {
      headers["origin"] = target.origin;
      continue;
    }
    if (lower === "referer") {
      headers["referer"] = String(value).startsWith(proxyOrigin) ? target.origin + String(value).slice(proxyOrigin.length) : target.origin + "/";
      continue;
    }
    headers[key] = value;
  }
  headers["host"] = target.host;
  const wantsHtml = String(req.headers["accept"] ?? "").includes("text/html");
  if (wantsHtml) headers["accept-encoding"] = "identity";
  const upstream = https.request(upstreamUrl, { method: req.method, headers, agent, timeout: 0 }, (up) => {
    const outHeaders = {};
    for (const [key, value] of Object.entries(up.headers)) {
      if (value === void 0) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      if (STRIP_RESPONSE_HEADERS.has(lower)) continue;
      if (lower === "location") {
        outHeaders["location"] = rewriteLocation(Array.isArray(value) ? value[0] : String(value), target, proxyOrigin);
        continue;
      }
      if (lower === "set-cookie") {
        const list = Array.isArray(value) ? value : [String(value)];
        outHeaders["set-cookie"] = list.map(rewriteSetCookie);
        continue;
      }
      outHeaders[key] = value;
    }
    const contentType = String(up.headers["content-type"] ?? "");
    const contentEncoding = String(up.headers["content-encoding"] ?? "identity");
    if (contentType.startsWith("text/html") && (contentEncoding === "identity" || contentEncoding === "")) {
      delete outHeaders["content-length"];
      const chunks = [];
      up.on("data", (chunk) => chunks.push(chunk));
      up.on("end", () => {
        const html = rewriteShellHtml(Buffer.concat(chunks).toString("utf8"));
        const body = Buffer.from(html, "utf8");
        outHeaders["content-length"] = String(body.byteLength);
        res.writeHead(up.statusCode ?? 502, outHeaders);
        res.end(body);
      });
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "upstream stream error" }));
      });
      return;
    }
    res.writeHead(up.statusCode ?? 502, outHeaders);
    up.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    }
    res.end(JSON.stringify({ error: `upstream error: ${error.message}` }));
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}
async function startProxy(config, log) {
  const target = new URL(config.target ?? DEFAULT_TARGET);
  const agent = createUpstreamAgent();
  let server = null;
  let origin = "";
  const listen = (port) => new Promise((resolve, reject) => {
    const candidate = http.createServer();
    candidate.timeout = 0;
    candidate.requestTimeout = 0;
    candidate.headersTimeout = 6e4;
    candidate.on("error", reject);
    candidate.listen(port, "127.0.0.1", () => {
      candidate.removeListener("error", reject);
      server = candidate;
      resolve(candidate.address().port);
    });
  });
  let boundPort;
  try {
    boundPort = await listen(config.port ?? DEFAULT_PORT);
  } catch {
    boundPort = await listen(0);
    log(`[deepseek-chat] 端口 ${config.port ?? DEFAULT_PORT} 被占用，代理改用 ${boundPort}`);
  }
  origin = `http://127.0.0.1:${boundPort}`;
  server.on("connection", (socket) => socket.setNoDelay(true));
  server.on("request", (req, res) => {
    try {
      proxyRequest(target, agent, origin, req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  log(`[deepseek-chat] DeepSeek 网页版代理已启动：${origin} -> ${target.origin}`);
  return { server, agent, origin };
}
async function apply(ctx, config = {}) {
  const log = (msg) => ctx.logger?.info(msg);
  const { server, agent, origin } = await startProxy(config, log);
  ctx.effect(() => () => {
    server.close();
    server.closeAllConnections?.();
    agent.destroy();
  }, "deepseek-chat: upstream proxy");
  ctx.effect(() => {
    ctx.webServer.register({
      kind: "prefix",
      path: "/dsh-deepseek-chat",
      handler: (req, res) => {
        const pathname = (req.url ?? "").split("?", 1)[0];
        if (req.method === "GET" && (pathname === "/dsh-deepseek-chat" || pathname === "/dsh-deepseek-chat/" || pathname === "/dsh-deepseek-chat/config")) {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ url: origin + "/", target: config.target ?? DEFAULT_TARGET }));
          return;
        }
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
  }, "deepseek-chat: config route");
}
export {
  apply,
  inject,
  name
};
