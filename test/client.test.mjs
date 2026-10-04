/**
 * lib/client.js 行为测试（jsdom）。
 *
 * 构建产物是浏览器脚本，所以测试在真实 DOM 语义下跑：把 lib/client.js
 * eval 进 jsdom 窗口，用一个假的 __ModuleLoader__ 收下注册项，再拿假 ctx
 * 跑 apply()，然后像用户那样点〔对话 | CHAT〕胶囊，断言：
 *
 *  - 插件只依赖 locale，不再注册 conversation.view（不再挂在「轨迹」后面）；
 *  - 顶部胶囊常驻，切换会整窗口接管，iframe 指向 config 返回的代理地址；
 *  - 切回「对话」只是把 iframe 挪走隐身——同一个元素、不重新拉 config；
 *  - config 失败时覆盖层给出错误 + 重试；
 *  - 卸载时自有节点清干净，驻留 iframe 不销毁。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SOURCE = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const CONFIG_URL = '/dsh-deepseek-chat/config'
const PROXY_URL = 'http://127.0.0.1:3377/'

/** 按 lib/client.js 的接口把插件装进一个全新 jsdom 窗口。 */
function mount({ configOk = true, url = PROXY_URL } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"><main>dsh</main></div></body></html>',
    { url: 'http://127.0.0.1:3080/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() },
  )
  const { window } = dom
  const fetches = []
  const opened = []
  window.fetch = async (target) => {
    fetches.push(String(target))
    if (!configOk) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ url, target: 'https://chat.deepseek.com' }) }
  }
  window.open = (...args) => { opened.push(args); return null }

  const registrations = []
  window.__ModuleLoader__ = { mode: 'web', load: (registration) => { registrations.push(registration) } }
  window.eval(CLIENT_SOURCE)
  assert.equal(registrations.length, 1, '插件应向 __ModuleLoader__ 注册一次')
  assert.equal(registrations[0].id, '@local/dsh-deepseek-chat')

  const mod = registrations[0].factory()
  const dictionary = {}
  const disposers = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    locale: {
      register: (_ns, dicts) => { Object.assign(dictionary, dicts.zh) },
      bind: () => (key) => dictionary[key] ?? key,
    },
  }
  mod.apply(ctx)

  const doc = window.document
  return {
    window, doc, mod, ctx, fetches, opened, dictionary,
    /** 顶部胶囊的两个分段：[对话, CHAT]。 */
    segments: () => [...doc.querySelectorAll('.dshdc-switch .dshdc-seg')],
    overlay: () => doc.querySelector('.dshdc-overlay'),
    /** 覆盖层是否处于收起态（用 visibility 隐身，不能用 display:none）。 */
    idle: () => doc.querySelector('.dshdc-overlay').hasAttribute('data-idle'),
    wrap: () => doc.querySelector('.dshdc-frameWrap'),
    frame: () => doc.querySelector('.dshdc-frame'),
    state: () => doc.querySelector('.dshdc-state'),
    retry: () => [...doc.querySelectorAll('.dshdc-btn')].find(node => node.textContent === dictionary['state.retry']),
    root: () => doc.getElementById('root'),
    unmount: () => { for (const dispose of disposers.splice(0)) dispose() },
  }
}

/** 让 fetch 的 promise 链跑完。 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('顶部胶囊取代会话视图标签环', () => {
  const app = mount()
  assert.deepEqual(Array.from(app.mod.inject), ['locale'], '不再注入 slots，也就不再注册 conversation.view')

  const [dsh, chat] = app.segments()
  assert.equal(dsh.textContent, '对话')
  assert.equal(chat.textContent, 'CHAT')
  assert.equal(dsh.getAttribute('aria-pressed'), 'true', '默认停在 DSH 界面')
  assert.equal(chat.getAttribute('aria-pressed'), 'false')
  assert.equal(app.doc.querySelector('.dshdc-switch').getAttribute('aria-label'), '视图切换')

  assert.equal(app.idle(), true, 'CHAT 覆盖层默认收起')
  assert.equal(app.frame(), null, '没切到 CHAT 之前不建 iframe')
  assert.deepEqual(app.fetches, [], '没切到 CHAT 之前不拉 config')

  const css = [...app.doc.querySelectorAll('style')].map(node => node.textContent).join('\n')
  assert.match(css, /\.dshdc-switch\{position:fixed;z-index:501;top:10px;left:50%/, '胶囊常驻窗口顶部中央')
  assert.match(css, /\.dshdc-overlay\{position:fixed;z-index:500;inset:0/, '覆盖层整窗口铺满')

  assert.equal(app.doc.querySelector('.dshdc-hint'), null, '不再有说明文案')
  assert.equal(app.doc.querySelector('.dshdc-bar'), null, '工具条本身也去掉，不占任何横向条带')
  assert.equal(app.doc.querySelector('.dshdc-actions').textContent, '', '浮动按钮组不含任何文字')
  assert.match(css, /\.dshdc-actions\{position:fixed;z-index:501;top:10px;right:46px/, '刷新浮在右上角、与胶囊同层，且钉在原格不贴边')
  assert.doesNotMatch(css, /\.dshdc-hint/, '说明文案的样式一并删掉')
  assert.doesNotMatch(css, /\.dshdc-bar/, '工具条的样式一并删掉')

  const stage = app.doc.querySelector('.dshdc-stage')
  assert.equal(stage.parentElement, app.overlay(), '覆盖层里只剩舞台，iframe 铺满整个窗口')
  assert.equal(app.doc.querySelector('.dshdc-actions').parentElement, app.overlay(), '按钮组挂在覆盖层里，随它一起隐身')
})

test('切到 CHAT：拉 config、整窗口接管、加载代理地址', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()

  assert.equal(app.idle(), false, '点 CHAT 立刻展开覆盖层')
  assert.equal(chat.getAttribute('aria-pressed'), 'true')
  assert.equal(app.state().hidden, false, 'config 回来之前显示连接中')
  assert.deepEqual(app.fetches, [CONFIG_URL])
  if ('inert' in app.window.HTMLElement.prototype) {
    assert.equal(app.root().inert, true, '被盖住的 DSH 界面进入 inert')
  }

  await flush()

  const frame = app.frame()
  assert.equal(frame.src, PROXY_URL)
  assert.equal(frame.parentElement, app.wrap())
  assert.equal(app.wrap().parentElement.className, 'dshdc-stage', 'iframe 挂在覆盖层舞台里')

  frame.dispatchEvent(new app.window.Event('load'))
  assert.equal(app.state().hidden, true, '首屏 load 后撤掉连接中遮罩')
})

test('切回对话不重载 iframe：同一元素、同一舞台、只拉一次 config', async () => {
  const app = mount()
  const [dsh, chat] = app.segments()
  chat.click()
  await flush()
  const frame = app.frame()
  const stage = frame.parentElement.parentElement
  assert.equal(stage.className, 'dshdc-stage')

  dsh.click()
  assert.equal(app.idle(), true)
  assert.equal(dsh.getAttribute('aria-pressed'), 'true')
  assert.equal(app.frame(), frame, '同一个 iframe 元素，没有被重建')
  assert.equal(stage.parentElement, app.doc.querySelector('.dshdc-overlay'))
  assert.equal(frame.parentElement.parentElement, stage, '收起时不动 DOM，浏览上下文才不会被丢弃')
  assert.equal(app.wrap().parentElement, stage)
  if ('inert' in app.window.HTMLElement.prototype) assert.equal(app.root().inert, false)

  chat.click()
  await flush()
  assert.equal(app.frame(), frame)
  assert.equal(frame.parentElement.parentElement, stage)
  assert.deepEqual(app.fetches, [CONFIG_URL], 'config 只拉一次')
  assert.equal(app.idle(), false)
})

test('config 失败：覆盖层给出错误与重试', async () => {
  const app = mount({ configOk: false })
  const [, chat] = app.segments()
  chat.click()
  await flush()

  assert.equal(app.idle(), false)
  assert.equal(app.state().hidden, false)
  assert.equal(app.state().textContent.includes('无法连接本地代理服务'), true)
  assert.notEqual(app.retry(), undefined, '提供重试按钮')
  assert.equal(app.retry().hidden, false)
  assert.equal(app.frame(), null, '没有地址就不建 iframe')
  assert.equal(app.retry().disabled, false)
})

test('刷新按钮：只有图标，文字进 aria-label', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()

  const buttons = [...app.doc.querySelectorAll('.dshdc-actions .dshdc-btn.dshdc-iconbtn')]
  assert.deepEqual(buttons.map(node => node.getAttribute('aria-label')), ['刷新'])
  assert.deepEqual(buttons.map(node => node.getAttribute('title')), ['刷新'])
  assert.deepEqual(buttons.map(node => node.textContent), [''], '按钮里没有任何文字')
  assert.deepEqual(buttons.map(node => node.querySelectorAll('svg').length), [1], '按钮里是一枚 svg 图标')
  assert.equal(buttons[0].disabled, false)
})

test('刷新按钮重新导航 iframe', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()

  const frame = app.frame()
  frame.dispatchEvent(new app.window.Event('load'))
  assert.equal(app.state().hidden, true, '首屏 load 后遮罩撤掉')

  // 记录 src 的写入：刷新必须真的重设 src——浏览器据此重新导航整个文档。
  const writes = []
  let current = frame.getAttribute('src')
  Object.defineProperty(frame, 'src', {
    configurable: true,
    get: () => current,
    set: (next) => { writes.push(next); current = next; frame.setAttribute('src', next) },
  })

  const button = app.doc.querySelector('.dshdc-actions .dshdc-btn')
  button.click()

  assert.deepEqual(writes, [PROXY_URL], '刷新 = 重设 src 重新导航到代理地址')
  assert.equal(app.frame(), frame, '还是同一个 iframe 元素，没有被重建')
  assert.equal(app.state().hidden, false, '刷新期间盖回加载遮罩')
  assert.match(app.state().textContent, /正在刷新 DeepSeek 网页版/, '文案切到「正在刷新」')

  frame.dispatchEvent(new app.window.Event('load'))
  assert.equal(app.state().hidden, true, '重新 load 完撤掉遮罩')
})

test('回归护栏：客户端不再出现跨源会抛 SecurityError 的 contentWindow 访问', () => {
  // iframe 与宿主不同源（DSH 3080 / 代理 3377），contentWindow.location 的
  // reload() 与 href 都会被浏览器按跨域拒绝——旧实现正是这样静默失灵的。
  assert.doesNotMatch(CLIENT_SOURCE, /contentWindow/, '刷新只能靠重设 src，不能读 iframe 的 Location')
})

test('「在浏览器打开」整枚删除：不再有第二枚按钮，也不再开新窗口', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()

  const buttons = [...app.doc.querySelectorAll('.dshdc-actions .dshdc-btn')]
  assert.equal(buttons.length, 1, '右上角只剩一枚按钮')
  assert.equal(buttons[0].getAttribute('aria-label'), '刷新', '留下的必须是刷新')
  assert.equal(app.dictionary['action.openExternal'], undefined, '「在浏览器打开」的文案也从字典里删掉')
  assert.deepEqual(app.opened, [], '已经没有会调用 window.open 的路径')
})

test('Esc 退出 CHAT 模式', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()

  app.window.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(app.idle(), true)
  assert.equal(app.segments()[1].getAttribute('aria-pressed'), 'false')
})

test('卸载：自有节点全部清干净', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()
  assert.notEqual(app.frame(), null)

  app.unmount()

  assert.equal(app.doc.querySelector('.dshdc-host'), null)
  assert.equal(app.doc.querySelector('.dshdc-switch'), null)
  assert.equal(app.doc.querySelectorAll('style[data-plugin="@local/dsh-deepseek-chat"]').length, 0)
  assert.equal(app.frame(), null, 'iframe 随宿主节点一起离开文档')
  if ('inert' in app.window.HTMLElement.prototype) assert.equal(app.root().inert, false, 'inert 必须解除')
})

test('收起态不许动 DOM：只用 visibility 隐身', () => {
  const app = mount()
  const css = [...app.doc.querySelectorAll('style')].map(node => node.textContent).join('\n')
  assert.match(css, /\.dshdc-overlay\[data-idle\]\{visibility:hidden;pointer-events:none\}/)
  assert.doesNotMatch(css, /\.dshdc-overlay\[hidden\]/, 'display:none 之外，更不能用搬 DOM 的方式收起')
  assert.doesNotMatch(css, /data-parked/, '驻留 iframe 不再有「挪回 body」的样式')
})
