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
        "state.loading": "正在连接 DeepSeek 网页版…",
        "state.error": "无法连接本地代理服务",
        "state.retry": "重试"
      };
      const en = {
        "mode.switch": "View switch",
        "mode.dsh": "Conversation",
        "mode.chat": "CHAT",
        "state.loading": "Connecting to DeepSeek Web…",
        "state.error": "Cannot reach the local proxy",
        "state.retry": "Retry"
      };
      const CSS = [
        // 胶囊落在窗口顶部 chrome 带里（macOS 48px 安全区 / Windows 标题栏），居中
        // 不碰两侧控件。桌面端那一带是 -webkit-app-region:drag 的拖拽区，而 Electron
        // 的拖拽区按几何命中、不看 z-index，必须显式 no-drag，否则点了被吞。
        ".dshdc-switch{position:fixed;z-index:501;top:max(10px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);display:flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}",
        ".dshdc-seg{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag}",
        ".dshdc-seg:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshdc-seg[aria-pressed='true'],.dshdc-seg[aria-pressed='true']:hover{background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-foreground)}",
        ".dshdc-seg:focus-visible,.dshdc-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
        ".dshdc-overlay{position:fixed;z-index:500;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}",
        ".dshdc-overlay[data-idle]{visibility:hidden;pointer-events:none}",
        ".dshdc-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}",
        ".dshdc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshdc-btn:disabled{cursor:not-allowed;opacity:.45}",
        ".dshdc-stage{position:relative;flex:1;min-height:0;background:#fff}",
        ".dshdc-frameWrap{position:absolute;inset:0;width:100%;height:100%}",
        ".dshdc-frame{display:block;width:100%;height:100%;border:0}",
        ".dshdc-state{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}",
        ".dshdc-state[hidden]{display:none}",
        ".dshdc-spinner{width:22px;height:22px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:dshdc-spin .8s linear infinite}",
        "@keyframes dshdc-spin{to{transform:rotate(360deg)}}",
        // 窄窗口（分屏、小窗 web / desktop）压缩胶囊，避免逼近页面顶栏两侧的控件。
        "@media (max-width:480px){.dshdc-switch{padding:2px}.dshdc-seg{height:24px;padding:0 9px;font-size:11px}}",
        "@media (max-width:420px){.dshdc-switch{gap:1px}.dshdc-seg{padding:0 7px;font-size:10px}}"
      ].join("\n");
      function el(tag, className) {
        const node = document.createElement(tag);
        if (className !== void 0) node.className = className;
        return node;
      }
      let persistent = null;
      let frameLoaded = false;
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
          const stage = el("div", "dshdc-stage");
          const state = el("div", "dshdc-state");
          const spinner = el("div", "dshdc-spinner");
          const stateText = el("div");
          const retryBtn = el("button", "dshdc-btn");
          retryBtn.type = "button";
          retryBtn.textContent = t("state.retry");
          state.append(spinner, stateText, retryBtn);
          stage.append(state);
          overlay.append(stage);
          host.append(switcher, overlay);
          document.body.append(host);
          const rootElement = () => {
            const byId = document.getElementById("root");
            if (byId !== null) return byId;
            for (const child of Array.from(document.body.children)) {
              if (!(child instanceof HTMLElement)) continue;
              if (child === host) continue;
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
            stateText.textContent = status === "error" ? t("state.error") : t("state.loading");
            retryBtn.hidden = status !== "error";
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
          const onKeyDown = (event) => {
            if (event.key === "Escape" && active) leave();
          };
          dshSeg.addEventListener("click", leave);
          chatSeg.addEventListener("click", enter);
          retryBtn.addEventListener("click", load);
          window.addEventListener("keydown", onKeyDown);
          notify = render;
          render();
          return () => {
            disposed = true;
            notify = null;
            dshSeg.removeEventListener("click", leave);
            chatSeg.removeEventListener("click", enter);
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
