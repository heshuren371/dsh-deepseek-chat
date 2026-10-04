"use strict";
(() => {
  // src/client/client-main.ts
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
        "state.retry": "重试"
      };
      const en = {
        "mode.switch": "View switch",
        "mode.dsh": "Conversation",
        "mode.chat": "CHAT",
        "action.reload": "Reload",
        "state.loading": "Connecting to DeepSeek Web…",
        "state.reloading": "Refreshing DeepSeek Web…",
        "state.error": "Cannot reach the local proxy",
        "state.retry": "Retry"
      };
      const CSS = [
        ".dshdc-switch{position:fixed;z-index:501;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012}",
        ".dshdc-seg{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer}",
        ".dshdc-seg:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshdc-seg[aria-pressed='true'],.dshdc-seg[aria-pressed='true']:hover{background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-foreground)}",
        ".dshdc-seg:focus-visible,.dshdc-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
        ".dshdc-overlay{position:fixed;z-index:500;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}",
        // 收起只用 visibility:hidden——iframe 一旦被移出文档（哪怕是挪到 body），
        // 浏览器就会丢弃它的嵌套浏览上下文、下次显示时整页重载。只做隐身则
        // 布局尺寸不变，登录态、草稿与滚动位置全都留着。
        ".dshdc-overlay[data-idle]{visibility:hidden;pointer-events:none}",
        // 没有工具条：刷新按钮直接浮在舞台右上角，与顶部胶囊同高（10px + 34px
        // 的行高，让 26px 的按钮正好与胶囊内的分段水平对齐）。z-index 501 跟着
        // 胶囊一层，压住 500 的覆盖层；覆盖层隐身时它随祖先一起隐藏。
        //
        // right 取 46px 而不是贴边的 12px：两枚按钮并排时刷新在「右起 46~72px」
        // 这一格，右边的「在浏览器打开」删掉后，必须把这一格钉住，否则刷新会滑
        // 到贴边处、改成去压 chat.deepseek.com 的「分享」按钮。
        ".dshdc-actions{position:fixed;z-index:501;top:10px;right:46px;height:34px;display:flex;align-items:center}",
        ".dshdc-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}",
        // 只留图形：按钮内容是一枚 svg，文字交给 aria-label / title。按钮浮在
        // chat.deepseek.com 的浅色页面上，所以自带实心底与投影（同胶囊一套），
        // 保证图标在任何底色上都看得见。
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
        "@keyframes dshdc-spin{to{transform:rotate(360deg)}}"
      ].join("\n");
      function el(tag, className) {
        const node = document.createElement(tag);
        if (className !== void 0) node.className = className;
        return node;
      }
      const SVG_NS = "http://www.w3.org/2000/svg";
      function icon(paths) {
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
      const ICON_RELOAD = ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"];
      let persistent = null;
      let frameLoaded = false;
      let reloading = false;
      let notify = null;
      function ensurePersistent(url) {
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
      const inject = ["locale"];
      function apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
        const t = ctx.locale.bind(NS);
        ctx.effect(() => {
          let disposed = false;
          let active = false;
          let status = "idle";
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
          const rootElement = () => {
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
          const setInert = (value) => {
            if (!("inert" in HTMLElement.prototype)) return;
            const root = rootElement();
            if (root !== null) root.inert = value;
          };
          const render = () => {
            dshSeg.setAttribute("aria-pressed", String(!active));
            chatSeg.setAttribute("aria-pressed", String(active));
            if (active) delete overlay.dataset.idle;
            else overlay.dataset.idle = "";
            const pending = active && (status !== "ready" || !frameLoaded);
            state.hidden = !pending;
            spinner.hidden = status !== "loading" && status !== "ready";
            stateText.textContent = status === "error" ? t("state.error") : reloading ? t("state.reloading") : t("state.loading");
            retryBtn.hidden = status !== "error";
            reloadBtn.disabled = status !== "ready";
          };
          const attach = () => {
            if (status !== "ready" || url === "") return;
            const entry = ensurePersistent(url);
            if (entry.wrap.parentElement !== stage) stage.insertBefore(entry.wrap, state);
          };
          const load = () => {
            if (disposed || status === "loading" || status === "ready") return;
            status = "loading";
            render();
            fetch(CONFIG_URL, { cache: "no-store" }).then((res) => {
              if (!res.ok) throw new Error("config http " + res.status);
              return res.json();
            }).then((json) => {
              if (disposed) return;
              if (typeof json.url !== "string" || json.url.length === 0) throw new Error("config missing url");
              url = json.url;
              status = "ready";
              render();
              attach();
            }).catch(() => {
              if (disposed) return;
              status = "error";
              render();
            });
          };
          const enter = () => {
            if (active) return;
            active = true;
            setInert(true);
            if (status === "ready") attach();
            else load();
            render();
          };
          const leave = () => {
            if (!active) return;
            active = false;
            setInert(false);
            render();
          };
          const onReload = () => {
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
          const onKeyDown = (event) => {
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
    }
  });
})();
