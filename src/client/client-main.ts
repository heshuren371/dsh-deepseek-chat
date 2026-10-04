/**
 * CHAT 模式客户端插件（TypeScript 源码）。
 *
 * 构建为 lib/client.js（IIFE），由 dsh 经 exports["./client"] 在
 * /plugins/<id>/client.js 提供给浏览器运行时（window.__ModuleLoader__）。
 *
 * 界面是挂在 document.body 上的两件常驻节点：顶部中央的胶囊〔对话 | CHAT〕，
 * 与整窗口覆盖层（连左侧会话栏一起盖住）。插件不注册 conversation.view，
 * 不出现在「对话 / 轨迹 / …」标签环里。
 *
 * CHAT 态把指向 Host 侧 loopback 反向代理的 iframe 铺满整个可视区，界面上
 * 只剩胶囊与右上角一枚刷新按钮。
 *
 * iframe 是全局单例，切换模式只改覆盖层可见性，不重建也不搬动它——理由见
 * persistent 的注释。
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-deepseek-chat",
  factory: () => {
    const NS = "dsh-deepseek-chat";
    const CONFIG_URL = "/dsh-deepseek-chat/config";

    const zh = {
      "mode.switch": "视图切换",
      "mode.dsh": "对话",
      "mode.chat": "CHAT",
      "action.reload": "刷新",
      "state.loading": "正在连接 DeepSeek 网页版…",
      "state.reloading": "正在刷新 DeepSeek 网页版…",
      "state.error": "无法连接本地代理服务",
      "state.retry": "重试",
    };
    const en = {
      "mode.switch": "View switch",
      "mode.dsh": "Conversation",
      "mode.chat": "CHAT",
      "action.reload": "Reload",
      "state.loading": "Connecting to DeepSeek Web…",
      "state.reloading": "Refreshing DeepSeek Web…",
      "state.error": "Cannot reach the local proxy",
      "state.retry": "Retry",
    };

    /**
     * DSH 帧内元素最高 z-index 20，账户提示 40，引导页 900，设置弹窗 1000。
     * 覆盖层取 500：盖住整个应用，把模态弹窗留给 DSH；胶囊取 501，任何状态下
     * 都能切回「对话」。
     */
    const CSS = [
      ".dshdc-switch{position:fixed;z-index:501;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012}",
      ".dshdc-seg{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer}",
      ".dshdc-seg:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      ".dshdc-seg[aria-pressed='true'],.dshdc-seg[aria-pressed='true']:hover{background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-foreground)}",
      ".dshdc-seg:focus-visible,.dshdc-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
      ".dshdc-overlay{position:fixed;z-index:500;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}",
      ".dshdc-overlay[data-idle]{visibility:hidden;pointer-events:none}",
      // 按钮浮在舞台右上角，与胶囊同高（10px + 34px，26px 的按钮正好与胶囊内
      // 的分段对齐）。right 取 46px：贴边 12px 会正好压住 chat.deepseek.com
      // 右上角的「分享」按钮。
      ".dshdc-actions{position:fixed;z-index:501;top:10px;right:46px;height:34px;display:flex;align-items:center}",
      ".dshdc-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}",
      // 按钮内容是 svg，名称走 aria-label / title。它压在 chat.deepseek.com 的
      // 浅色页面上，所以自带实心底与投影。
      ".dshdc-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;padding:0;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012}",
      ".dshdc-iconbtn svg{display:block;width:14px;height:14px}",
      ".dshdc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dshdc-btn:disabled{cursor:not-allowed;opacity:.45}",
      ".dshdc-stage{position:relative;flex:1;min-height:0;background:#fff}",
      ".dshdc-frameWrap{position:absolute;inset:0;width:100%;height:100%}",
      ".dshdc-frame{display:block;width:100%;height:100%;border:0}",
      ".dshdc-state{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}",
      ".dshdc-state[hidden]{display:none}",
      ".dshdc-spinner{width:22px;height:22px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:dshdc-spin .8s linear infinite}",
      "@keyframes dshdc-spin{to{transform:rotate(360deg)}}",
    ].join("\n");

    function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
      const node = document.createElement(tag);
      if (className !== undefined) node.className = className;
      return node;
    }

    const SVG_NS = "http://www.w3.org/2000/svg";

    /**
     * 24 格线稿图标：stroke 取 currentColor，跟随按钮前景色与 disabled 的
     * 透明度；aria-hidden 让读屏只念按钮的 aria-label。
     */
    function icon(paths: string[]): SVGSVGElement {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      for (const d of paths) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
      }
      return svg;
    }

    /** 刷新 ⟳（线稿几何取自 Lucide，MIT）。 */
    const ICON_RELOAD = ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"];

    /**
     * 全局驻留的 iframe。它只能入文档一次：iframe 节点一旦离开文档，浏览器
     * 就丢弃其嵌套浏览上下文，再插回来等于整页重载——登录态还在，草稿与滚动
     * 位置会丢。所以切换模式只改覆盖层可见性，绝不动这棵子树。
     */
    interface Persistent {
      wrap: HTMLDivElement;
      frame: HTMLIFrameElement;
      url: string;
    }
    let persistent: Persistent | null = null;
    /** 首屏是否已 load 过：决定覆盖层里是否还盖着加载遮罩。 */
    let frameLoaded = false;
    /** 是否正在手动刷新：只用来把提示文案从「正在连接」换成「正在刷新」。 */
    let reloading = false;
    /** 当前 effect 实例的重绘钩子（HMR 后指向最新实例）。 */
    let notify: (() => void) | null = null;

    /** 建好元素但不入文档——由 attach() 一次性挂进舞台。 */
    function ensurePersistent(url: string): Persistent {
      if (persistent !== null) return persistent;
      const wrap = el("div", "dshdc-frameWrap");
      const frame = el("iframe", "dshdc-frame");
      frame.setAttribute("allow", "clipboard-read; clipboard-write");
      frame.setAttribute("title", "chat.deepseek.com");
      frame.src = url;
      frame.addEventListener("load", () => {
        frameLoaded = true;
        reloading = false;
        notify?.();
      });
      wrap.appendChild(frame);
      persistent = { wrap, frame, url };
      return persistent;
    }

    /** 覆盖模式只保留 locale。 */
    const inject = ["locale"];

    function apply(ctx: any): void {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
      const t: (key: string) => string = ctx.locale.bind(NS);

      ctx.effect(() => {
        let disposed = false;
        let active = false;
        let status: "idle" | "loading" | "ready" | "error" = "idle";
        let url = "";

        const style = document.createElement("style");
        style.dataset.plugin = "@local/dsh-deepseek-chat";
        style.dataset.pluginCss = NS;
        style.textContent = CSS;
        document.head.appendChild(style);

        const host = el("div", "dshdc-host");

        const switcher = el("div", "dshdc-switch");
        switcher.setAttribute("role", "group");
        switcher.setAttribute("aria-label", t("mode.switch"));
        const dshSeg = el("button", "dshdc-seg");
        dshSeg.type = "button";
        dshSeg.textContent = t("mode.dsh");
        const chatSeg = el("button", "dshdc-seg");
        chatSeg.type = "button";
        chatSeg.textContent = t("mode.chat");
        switcher.append(dshSeg, chatSeg);

        const overlay = el("div", "dshdc-overlay");
        overlay.dataset.idle = "";

        const actions = el("div", "dshdc-actions");
        const reloadBtn = el("button", "dshdc-btn dshdc-iconbtn");
        reloadBtn.type = "button";
        reloadBtn.title = t("action.reload");
        reloadBtn.setAttribute("aria-label", t("action.reload"));
        reloadBtn.append(icon(ICON_RELOAD));
        actions.append(reloadBtn);

        const stage = el("div", "dshdc-stage");
        const state = el("div", "dshdc-state");
        const spinner = el("div", "dshdc-spinner");
        const stateText = el("div");
        const retryBtn = el("button", "dshdc-btn");
        retryBtn.type = "button";
        retryBtn.textContent = t("state.retry");
        state.append(spinner, stateText, retryBtn);
        stage.append(state);

        overlay.append(actions, stage);
        host.append(switcher, overlay);
        document.body.append(host);

        /**
         * DSH 应用根节点：覆盖模式下用 inert 屏蔽被盖住的界面，否则 Tab
         * 会走进不可见的按钮、快捷键也会落到隐藏的会话上。优先 #root，
         * 退化为「body 里第一个既不是插件节点也不是 script/style 的元素」。
         */
        const rootElement = (): HTMLElement | null => {
          const byId = document.getElementById("root");
          if (byId !== null) return byId;
          for (const child of Array.from(document.body.children)) {
            if (!(child instanceof HTMLElement)) continue;
            if (child === host || child.classList.contains("dshdc-frameWrap")) continue;
            const tag = child.tagName;
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") continue;
            return child;
          }
          return null;
        };
        const setInert = (value: boolean): void => {
          if (!("inert" in HTMLElement.prototype)) return;
          const root = rootElement();
          if (root !== null) root.inert = value;
        };

        const render = (): void => {
          dshSeg.setAttribute("aria-pressed", String(!active));
          chatSeg.setAttribute("aria-pressed", String(active));
          if (active) delete overlay.dataset.idle;
          else overlay.dataset.idle = "";
          const pending = active && (status !== "ready" || !frameLoaded);
          state.hidden = !pending;
          spinner.hidden = status !== "loading" && status !== "ready";
          stateText.textContent = status === "error"
            ? t("state.error")
            : reloading ? t("state.reloading") : t("state.loading");
          retryBtn.hidden = status !== "error";
          reloadBtn.disabled = status !== "ready";
        };

        /** 只挂第一次；parentElement 已是本舞台就不动，重复挂载会移动 iframe。 */
        const attach = (): void => {
          if (status !== "ready" || url === "") return;
          const entry = ensurePersistent(url);
          if (entry.wrap.parentElement !== stage) stage.insertBefore(entry.wrap, state);
        };

        const load = (): void => {
          if (disposed || status === "loading" || status === "ready") return;
          status = "loading";
          render();
          fetch(CONFIG_URL, { cache: "no-store" })
            .then((res) => {
              if (!res.ok) throw new Error("config http " + res.status);
              return res.json();
            })
            .then((json: { url?: string }) => {
              if (disposed) return;
              if (typeof json.url !== "string" || json.url.length === 0) throw new Error("config missing url");
              url = json.url;
              status = "ready";
              render();
              attach();
            })
            .catch(() => {
              if (disposed) return;
              status = "error";
              render();
            });
        };

        const enter = (): void => {
          if (active) return;
          active = true;
          setInert(true);
          if (status === "ready") attach();
          else load();
          render();
        };

        const leave = (): void => {
          if (!active) return;
          active = false;
          setInert(false);
          render();
        };

        /**
         * 刷新 = 重设 src，让浏览器重新导航 iframe。
         *
         * 不能用 contentWindow.location.reload()：iframe 与宿主不同源（DSH
         * 3080 / 代理 3377），跨源读 Location 会被浏览器拒绝并抛 SecurityError。
         * location.href 同样读不到，因此无法保留 DeepSeek 当前路由——刷新落点
         * 是代理根地址，与整页刷新后 iframe 重建到 config 地址一致。
         */
        const onReload = (): void => {
          const entry = persistent;
          if (entry === null) {
            load();
            return;
          }
          if (url === "") return;
          reloading = true;
          frameLoaded = false;
          entry.url = url;
          entry.frame.src = url;
          render();
        };

        const onKeyDown = (event: KeyboardEvent): void => {
          // iframe 内的按键不会冒泡到这里，仅在焦点还在宿主页面时生效
          if (event.key === "Escape" && active) leave();
        };

        dshSeg.addEventListener("click", leave);
        chatSeg.addEventListener("click", enter);
        reloadBtn.addEventListener("click", onReload);
        retryBtn.addEventListener("click", load);
        window.addEventListener("keydown", onKeyDown);
        notify = render;
        render();

        return () => {
          disposed = true;
          notify = null;
          dshSeg.removeEventListener("click", leave);
          chatSeg.removeEventListener("click", enter);
          reloadBtn.removeEventListener("click", onReload);
          retryBtn.removeEventListener("click", load);
          window.removeEventListener("keydown", onKeyDown);
          setInert(false);
          host.remove();
          style.remove();
        };
      }, "deepseek-chat: chat mode");
    }

    return { apply, inject };
  },
});
