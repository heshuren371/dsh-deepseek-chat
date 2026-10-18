/**
 * lib/index.js（Host 侧）行为测试。
 *
 * 用本地 http 服务当 chat.deepseek.com 的替身：配置 target 指过去、代理端口取
 * 0，再像浏览器那样请求代理。验证跨站拒绝、响应头剥离与重写、shell HTML 改写，
 * 以及上游中途断开不会冒成未捕获异常。
 */
import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/** 请求代理，收集完整响应；不跟随重定向。 */
function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/** 假 cordis ctx：收下 webServer 路由与 effect 的 disposer。 */
function makeContext() {
  const routes = []
  const disposers = []
  return {
    routes,
    disposers,
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    effect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    logger: { info() {}, warn() {}, error() {} },
  }
}

/** 调一次 webServer 路由处理器，返回 { status, headers, body }。 */
function invokeRoute(handler, reqLike) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const headers = {}
    let status = 0
    const res = {
      writeHead(code, values) { status = code; Object.assign(headers, values ?? {}) },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk))
        resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') })
      },
    }
    try {
      handler(reqLike, res)
    } catch (error) {
      reject(error)
    }
  })
}

/** 起上游替身 + 插件，返回代理 origin 与关闭钩子。 */
async function start(upstreamHandler) {
  let hits = 0
  const upstream = http.createServer((req, res) => {
    hits += 1
    upstreamHandler(req, res)
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = upstream.address().port
  const targetOrigin = `http://127.0.0.1:${upstreamPort}`

  const ctx = makeContext()
  await apply(ctx, { port: 0, target: targetOrigin })

  const route = ctx.routes.find((entry) => entry.path === '/dsh-deepseek-chat')
  const config = await invokeRoute(route.handler, { method: 'GET', url: '/dsh-deepseek-chat/config', headers: {} })
  const origin = JSON.parse(config.body).url.replace(/\/$/, '')

  return {
    origin,
    targetOrigin,
    hits: () => hits,
    async close() {
      for (const dispose of ctx.disposers.splice(0).reverse()) await dispose()
      upstream.closeAllConnections()
      await new Promise((resolve) => upstream.close(resolve))
    },
  }
}

test('CSP 只允许本机页面嵌入：外部站点无法把代理塞进 iframe', async () => {
  const s = await start((_req, res) => { res.writeHead(200); res.end('ok') })
  try {
    const r = await request(s.origin + '/')
    const csp = r.headers['content-security-policy']
    assert.match(csp, /frame-ancestors/)
    assert.match(csp, /http:\/\/127\.0\.0\.1:\*/)
    assert.match(csp, /http:\/\/localhost:\*/)
    assert.doesNotMatch(csp, /frame-ancestors 'none'/, '上游那条禁止嵌入的 CSP 不能残留')
  } finally {
    await s.close()
  }
})

test('同站请求被转发，Host / Origin / Referer 改写成上游', async () => {
  let seen
  const s = await start((req, res) => {
    seen = req.headers
    res.writeHead(200)
    res.end('ok')
  })
  try {
    const r = await request(s.origin + '/api/v0/x?y=1', {
      'sec-fetch-site': 'same-site',
      origin: s.origin,
      referer: s.origin + '/chat',
    })
    assert.equal(r.status, 200)
    assert.equal(r.body, 'ok')
    assert.equal(seen.host, new URL(s.targetOrigin).host)
    assert.equal(seen.origin, s.targetOrigin)
    assert.equal(seen.referer, s.targetOrigin + '/chat')
    assert.equal(seen['sec-fetch-site'], undefined, 'sec-fetch-* 不透传给上游')
    assert.equal(s.hits(), 1)
  } finally {
    await s.close()
  }
})

test('响应头：剥离 CSP / XFO / HSTS / COOP，重写 Location 与 Set-Cookie', async () => {
  const s = await start((_req, res) => {
    res.writeHead(302, {
      location: s.targetOrigin + '/next',
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=31536000',
      'cross-origin-opener-policy': 'same-origin',
      'set-cookie': ['sid=1; Domain=.deepseek.com; Secure; HttpOnly; Path=/; Partitioned'],
    })
    res.end()
  })
  try {
    const r = await request(s.origin + '/')
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, s.origin + '/next')
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'/, '换成只允许本机嵌入的 CSP')
    assert.doesNotMatch(r.headers['content-security-policy'], /frame-ancestors 'none'/)
    assert.equal(r.headers['x-frame-options'], undefined)
    assert.equal(r.headers['strict-transport-security'], undefined)
    assert.equal(r.headers['cross-origin-opener-policy'], undefined)
    assert.deepEqual(r.headers['set-cookie'], ['sid=1; HttpOnly; Path=/'])
  } finally {
    await s.close()
  }
})

test('shell HTML 去掉 crossorigin / integrity，content-length 重算', async () => {
  const html = '<html><script crossorigin integrity="sha384-x" src="/a.js"></script></html>'
  const s = await start((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  try {
    const r = await request(s.origin + '/', { accept: 'text/html' })
    assert.equal(r.status, 200)
    assert.equal(r.body, '<html><script src="/a.js"></script></html>')
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.body))
  } finally {
    await s.close()
  }
})

test('上游中途断开：响应以网络错误结束，不会变成未捕获异常', async () => {
  const s = await start((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '1000' })
    res.write('partial')
    setTimeout(() => res.destroy(), 20)
  })
  try {
    await assert.rejects(request(s.origin + '/'), '客户端应看到连接被中断')
    // 未捕获的 IncomingMessage 'error' 会打崩进程；留一点时间给它冒出来。
    await new Promise((resolve) => setTimeout(resolve, 100))
  } finally {
    await s.close()
  }
})
