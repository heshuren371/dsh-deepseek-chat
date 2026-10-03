# dsh-deepseek-chat

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面的 DeepSeek 网页版插件：在 **DSH 窗口顶部中央**常驻一枚〔对话 | CHAT〕胶囊（做法参考 [dsh-synapse](https://github.com/liangmianya/dsh-synapse) 的视图切换器），点 CHAT 即**整窗口接管**，把 [chat.deepseek.com](https://chat.deepseek.com/) 完整铺进 DSH Web GUI；点「对话」原样回到 DSH。

> v0.2.0 起不再注册会话视图标签页——插件**不会**出现在「对话 / 轨迹 / …」标签环里。

## 原理 / How it works

chat.deepseek.com 带有 `content-security-policy: frame-ancestors 'none'`，浏览器不允许任何站点用 iframe 嵌入它。本插件因此不是简单塞一个 iframe，而是：

1. **Host 侧**：启动一个**仅监听 127.0.0.1** 的 HTTP 反向代理（默认端口 3377，占用时自动回退随机端口），整域转发 `https://chat.deepseek.com`：
   - 剥离 `content-security-policy` / `x-frame-options` / COOP / COEP / CORP / `strict-transport-security` 响应头（HSTS 透传会把浏览器对 127.0.0.1 整个 host 升级到 https，代理与 DSH 双双挂掉）；
   - 重写 `Set-Cookie`（去 `Domain` / `Secure` / `Partitioned`，适配 http loopback 与 Safari）与 `Location` 重定向；
   - 改写 shell HTML：去掉首屏两个 `<script>` 的 `crossorigin` + SRI `integrity`（CDN 只放行 deepseek.com 系 Origin，不换掉必触发「页面资源加载异常」）；字节本身不变，SRI 语义无损；
   - 其余响应体**原样透传**，SSE 流式补全逐块转发、无缓冲；上游 TLS keep-alive 连接池复用（热请求省掉整次握手，实测首请求 255ms → 后续 67ms）；本地 socket 关 Nagle，流式分片即达；
   - 静态资源本来就在 CDN（fe-static.deepseek.com），API 全是相对路径 `/api/v0/...`，无 WebSocket——整域代理即可完整工作。
2. **客户端**：在 `document.body` 上挂一枚 `position:fixed` 的胶囊〔对话 | CHAT〕（z-index 501）与一个整窗口覆盖层（z-index 500，盖住全部三列含左侧会话栏）：
   - 覆盖层不留任何条带：iframe 铺满整个窗口，界面上只剩三枚按钮——顶部中央的〔对话 \| CHAT〕胶囊，加右上角浮动的一枚刷新图标 ⟳（刻意内缩、不贴边，避开 chat.deepseek.com 自己的「分享」按钮）；刷新按钮自带实心底与投影，压在任何页面上都看得清，其 `aria-label` / `title` 保留完整中文名，读屏与悬停提示照旧；
   - CHAT 模式给 `#root` 加 `inert`，隐藏的 DSH 界面不再能被 Tab / 快捷键误触；
   - iframe 指向代理地址（从 `/dsh-deepseek-chat/config` 动态获取，**首次切到 CHAT 才拉取**）；
   - iframe 是全局单例：第一次切到 CHAT 时创建并挂进覆盖层，之后**永不搬动**；切回「对话」只把覆盖层 `visibility:hidden`。iframe 一旦被移出文档，浏览器就会丢弃它的嵌套浏览上下文、再显示时整页重载（登录态虽在，草稿与滚动位置会丢）——只做隐身则布局尺寸不变，状态全程保留。

## 快速安装 / Quick Install

前置条件：已安装 DSH 并能打开 Web 界面（<http://127.0.0.1:3080>）。

```bash
dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat
```

重启 `dsh web`，刷新浏览器——窗口顶部中央出现〔对话 | CHAT〕胶囊即成功。

想锁定版本：`dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat#v0.2.0`

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

- **第三方 OAuth 登录（Google 等）在 iframe 内不可用**（Google 同样禁止被嵌框）；请直接用手机号 / 邮箱验证码登录。原先的「在浏览器打开」入口因与网页版「分享」按钮重叠已整枚删除；确实需要另开浏览器窗口时，自行访问代理地址即可（`/dsh-deepseek-chat/config` 返回的 `url`，默认 <http://127.0.0.1:3377/>）。
- CHAT 模式整窗口接管期间，被盖住的 DSH 界面**不可交互也不可见**：需要审批提示、任务进度或设置时，先点「对话」切回去（设置类弹窗 z-index 高于覆盖层，仍会浮在最上面）。
- 右上角那枚刷新按钮刻意内缩 46px 而不贴边——贴边正好落在 chat.deepseek.com「分享」按钮上；窗口特别窄时仍可能与页面控件靠近，切回「对话」即恢复 DSH 原界面。
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
npm test       # jsdom 下跑 lib/client.js 的行为测试（胶囊 / 接管 / iframe 驻留）
```

改完重启 `dsh web` 生效（客户端产物刷新浏览器即可；新增/移除 bundle 必须重启宿主）。

## 卸载 / Uninstall

```bash
dsh plugin --profile web remove @local/dsh-deepseek-chat
```

重启即彻底移除（代理进程随宿主退出，装配层自动清理）。
