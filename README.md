# dsh-deepseek-chat

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面的 DeepSeek 网页版插件：在 **DSH 窗口顶部中央**常驻一枚〔对话 | CHAT〕胶囊（做法参考 [dsh-synapse](https://github.com/liangmianya/dsh-synapse) 的视图切换器），点 CHAT 即**整窗口接管**，把 [chat.deepseek.com](https://chat.deepseek.com/) 完整铺进 DSH Web GUI；点「对话」原样回到 DSH。

> 插件不注册 conversation.view——不会出现在「对话 / 轨迹 / …」标签环里。

## 原理 / How it works

chat.deepseek.com 带有 `content-security-policy: frame-ancestors 'none'`，浏览器不允许任何站点用 iframe 嵌入它。本插件因此不是简单塞一个 iframe，而是：

1. **Host 侧**：启动一个**仅监听 127.0.0.1** 的 HTTP 反向代理（默认端口 3377，占用时自动回退随机端口），整域转发 `https://chat.deepseek.com`：
   - 剥离 `content-security-policy` / `x-frame-options` / COOP / COEP / CORP / `strict-transport-security` 响应头（HSTS 透传会把浏览器对 127.0.0.1 整个 host 升级到 https，代理与 DSH 双双挂掉）；
   - 重写 `Set-Cookie`（去 `Domain` / `Secure` / `Partitioned`，适配 http loopback 与 Safari）与 `Location` 重定向；
   - 改写 shell HTML：去掉首屏两个 `<script>` 的 `crossorigin` + SRI `integrity`（CDN 只放行 deepseek.com 系 Origin，不换掉必触发「页面资源加载异常」）；字节本身不变，SRI 语义无损；
   - 其余响应体**原样透传**，SSE 流式补全逐块转发、无缓冲；上游 TLS keep-alive 连接池复用（热请求省掉整次握手，实测首请求 255ms → 后续 67ms）；本地 socket 关 Nagle，流式分片即达；
   - 静态资源本来就在 CDN（fe-static.deepseek.com），API 全是相对路径 `/api/v0/...`，无 WebSocket——整域代理即可完整工作。
   - 在 DSH 的 HTTP 服务上另开 `GET /dsh-deepseek-chat/activity`（SSE）：代理侧按上游响应的 `text/event-stream` 统计活跃流，0↔1 变化时推送 `{"streaming":true|false}`，每 15s 一条心跳；客户端据此显示「生成中」。
2. **客户端**：在 `document.body` 上挂一枚 `position:fixed` 的胶囊〔对话 | CHAT〕（z-index 501）与一个整窗口覆盖层（z-index 500，盖住全部三列含左侧会话栏）：
   - 覆盖层不留任何条带：iframe 铺满整个窗口，界面上只剩顶部中央的〔对话 \| CHAT〕胶囊（`position:fixed`，z-index 501）。胶囊落在窗口顶部 48px 的 chrome 带里，居中避开页面顶栏两侧控件；桌面端显式 `-webkit-app-region:no-drag`，位于窗口拖拽区上方也能点；视口 ≤480px / ≤420px 自动收窄——对「☰ + 文字标 + 分享 + 头像」的顶栏实测，375px 起两侧无交叠，320px 以下不保证；
   - 胶囊空闲时只露当前模式那一段，鼠标悬停或键盘聚焦时展开成〔对话 \| CHAT〕两段；收起的那段仍留在 DOM 与 Tab 顺序里，读屏可读；
   - 胶囊左侧的活动点是 DSH 侧状态，四态：蓝色脉动 = 有任务在跑，琥珀色常亮 = 有审批待处理，绿色常亮 = 任务完成待查看（`aria-label` 同步）。它订阅 DSH 客户端的 `uiSession.sessionStatus`；在 CHAT 模式下点这个点可直接切回「对话」，服务不存在时静默不显示；
   - DeepSeek 正在生成时胶囊外圈有一道 1px 呼吸环（来自 Host 的 `/activity` SSE）；尊重 `prefers-reduced-motion`——系统开启「减弱动态效果」后环变静态、脉动与过渡全部取消，窗口不在前台时也暂停脉动；
   - 快捷键 `Cmd/Ctrl+Alt+J` 切换「对话 / CHAT」（命令 id `deepseek-chat.toggle`，可在 DSH 设置里改键；Linux 浏览器版因组合键白名单不含该键，需自行绑定）；它监听宿主页面，焦点在嵌入的 iframe 内时按不到，主要用于从「对话」进入 CHAT；
   - CHAT 模式给 `#root` 加 `inert`，隐藏的 DSH 界面不会被 Tab / 快捷键误触；
   - iframe 指向代理地址（从 `/dsh-deepseek-chat/config` 动态获取，**首次切到 CHAT 才拉取**）；
   - iframe 是全局单例：首次切到 CHAT 时创建并挂进覆盖层，此后不重建、不搬动；切回「对话」只把覆盖层 `visibility:hidden`。移出文档会让浏览器丢弃嵌套浏览上下文，再显示时整页重载（登录态还在，草稿与滚动位置会丢）。

## 快速安装 / Quick Install

前置条件：已安装 DSH 并能打开 Web 界面（<http://127.0.0.1:3080>）。

```bash
dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat
```

重启 `dsh web`，刷新浏览器——窗口顶部中央出现〔对话 | CHAT〕胶囊即成功。

想锁定版本：`dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat#v0.3.0`

## 更新 / Update

```bash
dsh plugin --profile web update @local/dsh-deepseek-chat
```

更新后重启 `dsh web` / `dsh desktop`。从 GitHub 安装的实例按 `package.json` 的 version 判断有没有新版本——所以每次发布都必须递增版本号并打 tag，否则更新面板只会显示「有新提交（未发版）」而拿不到改动。

## 开发者安装（克隆 + link）

```bash
git clone https://github.com/heshuren371/dsh-deepseek-chat.git
cd dsh-deepseek-chat && npm install && npm run build
cd ..
dsh plugin --profile web add link:./dsh-deepseek-chat
```

- link 方式不会自动构建，`npm run build` 必须做（产物 lib/ 也已随仓库提交，跳过构建通常也能跑）
- 装配后**不要移动或删除克隆目录**——profile 通过链接指向这个位置

## 限制 / Limitations

- **第三方 OAuth 登录（Google 等）在 iframe 内不可用**（Google 同样禁止被嵌框）；请直接用手机号 / 邮箱验证码登录。需要另开浏览器窗口时，自行访问代理地址（`/dsh-deepseek-chat/config` 返回的 `url`，默认 <http://127.0.0.1:3377/>）。
- CHAT 模式整窗口接管期间，被盖住的 DSH 界面**不可交互也不可见**：需要审批、任务进度或设置时，先点「对话」切回去（胶囊活动点只提示有没有活动，不显示细节；设置类弹窗 z-index 高于覆盖层，仍会浮在最上面）。
- 活动点依赖 DSH 客户端的 `uiSession.sessionStatus`（0.1.6 起才有，非公开插件契约）：版本升级后若数据形状变化，会静默退化为不显示，不报错、不影响其他功能。
- 快捷键只在焦点位于 DSH 宿主页面时生效：焦点进了 chat.deepseek.com 的 iframe 后按键属于 iframe 文档，宿主收不到，所以「退出 CHAT」仍要点胶囊或按 Esc。默认组合键若与 DSH 或其他插件冲突，注册会被静默跳过，可在设置页自行绑定。
- 「生成中」环依赖 Host 侧的 `/activity` 路由：只更新客户端、不重建 Host 产物时环不会出现（客户端会静默关闭这条连接）。
- 代理仅绑定 127.0.0.1，但本机任何进程都能访问该端口；它只转发公开的 chat.deepseek.com，不持有任何凭据（登录 cookie 存在你的浏览器里）。
- 剥 CSP 是让嵌入可行的必要手段，仅限 loopback 使用，请勿把代理暴露到局域网。

## 配置 / Config

在 profile 的 `cordis.patch.yml`（或插件自带 patch）中：

```yaml
- insert:
    - id: deepseek-chat
      name: '@local/dsh-deepseek-chat'
      config:
        port: 3377                          # 代理端口，0 = 自动分配
        target: https://chat.deepseek.com   # 上游站点
```

## 开发 / Develop

```bash
npm install    # 安装 esbuild / typescript（仅开发期）
npm run build  # 产出 lib/index.js + lib/client.js
npm run typecheck
npm test       # 客户端 jsdom 行为测试 + Host 代理/SSE 的真实 http 测试
```

改完重启 `dsh web` 生效（客户端产物刷新浏览器即可；新增/移除 bundle 必须重启宿主）。

## 卸载 / Uninstall

```bash
dsh plugin --profile web remove @local/dsh-deepseek-chat
```

重启即彻底移除（代理进程随宿主退出，装配层自动清理）。
