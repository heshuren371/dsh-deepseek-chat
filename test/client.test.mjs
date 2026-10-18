/**
 * lib/client.js 行为测试（jsdom）。
 *
 * 产物是浏览器脚本，所以在真实 DOM 语义下跑：把 lib/client.js eval 进 jsdom
 * 窗口，用假的 __ModuleLoader__ 收下注册项，再用假 ctx 跑 apply()。
 *
 * jsdom 不加载 iframe 内容、也复现不了跨源限制，所以断言的是节点与状态
 * （胶囊、覆盖层、iframe.src、遮罩文案、卸载清理）；「产物里不出现
 * contentWindow」那条护栏守着不读 iframe 的跨源 Location。
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
function mount({ configOk = true, url = PROXY_URL, activity = null } = {}) {
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
  const injectDeps = []
  let unsubscribed = 0
  let snapshot = new Map(activity?.rows ?? [])
  const listeners = new Set()
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { unsubscribed += 1; listeners.delete(fn) }
    },
  }
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
  if (activity !== null) {
    ctx.inject = (deps, cb) => {
      injectDeps.push(deps)
      const scope = {
        effect(fn) {
          const disposer = fn()
          if (typeof disposer === 'function') disposers.push(disposer)
          return disposer
        },
      }
      if (activity.service !== null) {
        const key = activity.service ?? 'sessionStatus'
        scope.uiSession = { [key]: source }
      }
      cb(scope)
    }
  }
  mod.apply(ctx)

  const doc = window.document
  return {
    window, doc, mod, ctx, fetches, opened, dictionary, injectDeps,
    /** 顶部胶囊的两个分段：[对话, CHAT]。 */
    segments: () => [...doc.querySelectorAll('.dshdc-switch .dshdc-seg')],
    switcher: () => doc.querySelector('.dshdc-switch'),
    dot: () => doc.querySelector('.dshdc-dot'),
    unsubscribed: () => unsubscribed,
    /** 替换活动快照并通知订阅者。 */
    emit: (rows) => { snapshot = new Map(rows); for (const fn of [...listeners]) fn() },
    overlay: () => doc.querySelector('.dshdc-overlay'),
    /** 覆盖层是否收起（收起用 visibility，不用 display:none）。 */
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
  assert.deepEqual(Array.from(app.mod.inject), ['locale'], '只注入 locale，不注册 conversation.view')

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
  assert.match(css, /\.dshdc-switch\{position:fixed;z-index:501;top:max\(10px,env\(safe-area-inset-top,0px\)\)/, '胶囊常驻窗口顶部中央、避开安全区')
  assert.match(css, /-webkit-app-region:no-drag/, '桌面端拖拽区里仍可点击')
  assert.match(css, /@media \(max-width:480px\)/, '窄窗口压缩胶囊')
  assert.match(css, /@media \(max-width:420px\)/, '更窄的窗口再压一档')
  assert.match(css, /\.dshdc-overlay\{position:fixed;z-index:500;inset:0/, '覆盖层整窗口铺满')

  assert.equal(app.doc.querySelector('.dshdc-hint'), null, '没有说明文案节点')
  assert.equal(app.doc.querySelector('.dshdc-bar'), null, '没有工具条')
  assert.equal(app.doc.querySelector('.dshdc-actions'), null, '没有浮动按钮组')
  assert.doesNotMatch(css, /\.dshdc-hint/, '说明文案的样式一并删掉')
  assert.doesNotMatch(css, /\.dshdc-bar/, '工具条的样式一并删掉')
  assert.doesNotMatch(css, /\.dshdc-actions/, '浮动按钮组的样式一并删掉')

  const stage = app.doc.querySelector('.dshdc-stage')
  assert.equal(stage.parentElement, app.overlay(), '覆盖层里只剩舞台，iframe 铺满整个窗口')
})

test('胶囊空闲只露当前段，悬停或聚焦时展开', async () => {
  const app = mount()
  const css = [...app.doc.querySelectorAll('style')].map(node => node.textContent).join('\n')
  const [dsh, chat] = app.segments()

  assert.equal(app.segments().length, 2, '两段都留在 DOM 里')
  assert.equal(dsh.getAttribute('aria-pressed'), 'true', '默认停在对话段')
  assert.equal(chat.getAttribute('aria-pressed'), 'false')
  assert.equal(app.doc.querySelector('.dshdc-switch').getAttribute('aria-label'), '视图切换')
  assert.equal(dsh.tabIndex, 0, '当前段可 Tab 到')
  assert.equal(chat.tabIndex, 0, '收起段仍留在 Tab 顺序里')

  assert.match(css, /\.dshdc-switch\{[^}]*gap:0/, '收起时两段间隙归零')
  assert.match(css, /\.dshdc-switch:hover,\.dshdc-switch:focus-within\{gap:var\(--dshdc-open-gap\)\}/, '悬停与聚焦恢复间隙')
  assert.match(css, /\.dshdc-switch\{[^}]*align-items:center/, '状态点与分段在胶囊里垂直居中')
  assert.match(css, /\.dshdc-seg\{[^}]*transition:max-width 150ms ease,opacity 150ms ease,padding 150ms ease/, '折叠/展开走 150ms 过渡')
  assert.match(css, /\.dshdc-seg\{[^}]*overflow:hidden/, '过渡期间裁掉溢出的文字')

  const collapsed = css.match(/\.dshdc-seg\[aria-pressed='false'\]\{[^}]*\}/)?.[0] ?? ''
  assert.match(collapsed, /max-width:0/, '收起段最大宽度归零')
  assert.match(collapsed, /padding:0/)
  assert.match(collapsed, /opacity:0/)
  assert.doesNotMatch(collapsed, /(?:^|[;{])width:/, '宽度只由 max-width 驱动')
  assert.doesNotMatch(collapsed, /display:none|visibility:hidden/, '收起段不退出可访问树')

  const expanded = css.match(/\.dshdc-switch:hover \.dshdc-seg\[aria-pressed='false'\][^{]*\{[^}]*\}/)?.[0] ?? ''
  assert.match(expanded, /max-width:160px/)
  assert.match(expanded, /opacity:1/)
  assert.doesNotMatch(expanded, /(?:^|[;{])width:/, '展开同样只由 max-width 驱动，收起与展开对称')
  assert.match(expanded, /\.dshdc-switch:focus-within \.dshdc-seg\[aria-pressed='false'\]/, '聚焦同样触发展开')

  chat.click()
  await flush()
  assert.equal(app.segments().length, 2, '切换模式不增删分段')
  assert.equal(chat.getAttribute('aria-pressed'), 'true')
  assert.equal(dsh.getAttribute('aria-pressed'), 'false')
  assert.equal(app.doc.querySelector('.dshdc-switch').getAttribute('aria-label'), '视图切换', 'aria-label 不随模式变化')
})

test('没有 ctx.inject 的旧 runtime：状态点隐藏且不抛错', () => {
  const app = mount()
  const dot = app.dot()
  assert.equal(dot.hidden, true)
  assert.equal(dot.dataset.state, '')
  assert.equal(dot.getAttribute('aria-hidden'), 'true')
  assert.equal(app.switcher().getAttribute('aria-label'), '视图切换')
  assert.equal(app.unsubscribed(), 0)
})

test('DSH 运行中：胶囊里出现脉动状态点', () => {
  const app = mount({
    activity: { rows: [['s1', { running: true, completionUnread: false }]] },
  })
  const dot = app.dot()
  assert.equal(dot.hidden, false)
  assert.equal(dot.dataset.state, 'running')
  assert.equal(app.switcher().getAttribute('aria-label'), '视图切换 · DSH 运行中')
  assert.deepEqual(app.injectDeps.map(deps => Array.from(deps)), [['uiSession']], '只走可选子 fiber，模块导出的 inject 不变')

  const css = [...app.doc.querySelectorAll('style')].map(node => node.textContent).join('\n')
  assert.match(css, /\.dshdc-dot[^{]*\{[^}]*width:0;height:6px;margin-right:0[^}]*opacity:0[^}]*transition:width 150ms ease,margin-right 150ms ease,opacity 150ms ease/)
  assert.match(css, /\.dshdc-dot\[data-state='running'\]\{[^}]*width:6px;margin-right:6px;opacity:1;animation:dshdc-pulse 1\.6s/, '运行中脉动')
  assert.match(css, /\.dshdc-dot\[data-state='approval'\]\{[^}]*background:var\(--dsw-alias-state-warn-primary\)/, '待审批用强调色常亮')
})

test('活动快照更新：状态点随订阅切换，胶囊不重建', () => {
  const app = mount({
    activity: { rows: [['s1', { running: true, completionUnread: false }]] },
  })
  const dot = app.dot()
  const switcher = app.switcher()
  const [dsh, chat] = app.segments()

  app.emit([['s1', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: true }]])

  assert.equal(app.dot(), dot, '状态点节点不重建')
  assert.equal(app.switcher(), switcher, '胶囊节点不重建')
  assert.equal(app.segments()[0], dsh)
  assert.equal(app.segments()[1], chat)
  assert.equal(dot.dataset.state, 'approval')
  assert.equal(switcher.getAttribute('aria-label'), '视图切换 · DSH 待审批')
})

test('question 互动不算待审批：状态点保持隐藏', () => {
  const app = mount({
    activity: { rows: [['s1', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: true }]] },
  })
  assert.equal(app.dot().hidden, true)
  assert.equal(app.dot().dataset.state, '')
  assert.equal(app.switcher().getAttribute('aria-label'), '视图切换')
})

test('uiSession 服务缺失：静默降级为无状态点', () => {
  const app = mount({ activity: { service: null } })
  assert.equal(app.dot().hidden, true)
  assert.equal(app.switcher().getAttribute('aria-label'), '视图切换')
  assert.equal(app.unsubscribed(), 0)
})

test('老版本只有 pendingInteractions：仍能提示待审批', () => {
  const app = mount({
    activity: { service: 'pendingInteractions', rows: [['s1', { pendingInteraction: { kind: 'approval' } }]] },
  })
  assert.equal(app.dot().hidden, false)
  assert.equal(app.dot().dataset.state, 'approval')
  assert.equal(app.switcher().getAttribute('aria-label'), '视图切换 · DSH 待审批')
})

test('卸载时退订活动状态源', () => {
  const app = mount({
    activity: { rows: [['s1', { running: true, completionUnread: false }]] },
  })
  assert.equal(app.unsubscribed(), 0)
  app.unmount()
  assert.equal(app.unsubscribed(), 1)
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

test('回归护栏：客户端不出现跨源会抛 SecurityError 的 contentWindow 访问', () => {
  // iframe 与宿主不同源（DSH 3080 / 代理 3377），contentWindow.location 的
  // reload() 与 href 都会被浏览器拒绝。
  assert.doesNotMatch(CLIENT_SOURCE, /contentWindow/, '客户端不读 iframe 的 Location')
})

test('界面里没有浮动按钮，客户端不调用 window.open', async () => {
  const app = mount()
  const [, chat] = app.segments()
  chat.click()
  await flush()

  assert.equal(app.doc.querySelectorAll('.dshdc-actions').length, 0, '没有浮动按钮组')
  assert.equal(app.doc.querySelectorAll('.dshdc-iconbtn').length, 0, '没有图标按钮')
  assert.equal(app.doc.querySelectorAll('svg').length, 0, '界面里没有 svg 图标')
  assert.equal(app.dictionary['action.reload'], undefined, '刷新文案已删')
  assert.equal(app.dictionary['state.reloading'], undefined, '刷新中文案已删')
  assert.deepEqual(app.opened, [], '没有会调用 window.open 的路径')
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
  assert.doesNotMatch(css, /data-parked/, '不存在把 iframe 挪回 body 的样式')
})
