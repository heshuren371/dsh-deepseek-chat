# dsh-deepseek-chat

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面的内嵌 DeepSeek 网页版插件。在会话视图标签环（对话 / 轨迹 / 音乐 / …）中注册「网页对话」标签页（order 30，位于「音乐」之后），把 [chat.deepseek.com](https://chat.deepseek.com/) 完整嵌进 DSH Web GUI。

## 原理 / How it works

chat.deepseek.com 带有 `content-security-policy: frame-ancestors 'none'`，浏览器不允许任何站点用 iframe 嵌入它。本插件因此不是简单塞一个 iframe，而是：

1. **Host 侧**：启动一个**仅监听 127.0.0.1** 的 HTTP 反向代理（默认端口 3377，占用时自动回退随机端口），整域转发 `https://chat.deepseek.com`：
   - 剥离 `content-security-policy` / `x-frame-options` / COOP / COEP / CORP / `strict-transport-security` 响应头（HSTS 透传会把浏览器对 127.0.0.1 整个 host 升级到 https，代理与 DSH 双双挂掉）；
   - 重写 `Set-Cookie`（去 `Domain` / `Secure` / `Partitioned`，适配 http loopback 与 Safari）与 `Location` 重定向；
   - 改写 shell HTML：去掉首屏两个 `<script>` 的 `crossorigin` + SRI `integrity`（CDN 只放行 deepseek.com 系 Origin，不换掉必触发「页面资源加载异常」）；字节本身不变，SRI 语义无损；
   - 其余响应体**原样透传**，SSE 流式补全逐块转发、无缓冲；上游 TLS keep-alive 连接池复用（热请求省掉整次握手，实测首请求 255ms → 后续 67ms）；本地 socket 关 Nagle，流式分片即达；
   - 静态资源本来就在 CDN（fe-static.deepseek.com），API 全是相对路径 `/api/v0/...`，无 WebSocket——整域代理即可完整工作。
2. **客户端**：在 `conversation.view` 槽位注册「网页对话」标签，iframe 指向代理地址（从 `/dsh-deepseek-chat/config` 动态获取）。iframe 驻留全局单例容器，**切换标签页 / HMR 不会重新加载**（也不重复拉取 config），登录态与草稿全程保留。

## 快速安装 / Quick Install

前置条件：已安装 DSH 并能打开 Web 界面（<http://127.0.0.1:3080>）。

```bash
dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat
```

重启 `dsh web`，刷新浏览器——会话顶部标签环出现「网页对话」即成功。

想锁定版本：`dsh plugin --profile web add github:heshuren371/dsh-deepseek-chat#v0.1.1`

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

- **第三方 OAuth 登录（Google 等）在 iframe 内不可用**（Google 同样禁止被嵌框）；请使用手机号 / 邮箱验证码登录，或先点「在浏览器打开」完成登录后再回来（同机 cookie 独立，需各自登录）。
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
npm install   # 安装 esbuild / typescript（仅开发期）
npm run build # 产出 lib/index.js + lib/client.js
npm run typecheck
```

改完重启 `dsh web`（或用 dsh-super-injector 热重载该包）生效。

## 卸载 / Uninstall

```bash
dsh plugin --profile web remove @local/dsh-deepseek-chat
```

重启即彻底移除（代理进程随宿主退出，装配层自动清理）。
