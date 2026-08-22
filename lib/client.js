"use strict";
(() => {
  // src/client/client-main.ts
  window.__ModuleLoader__.load({
    id: "@local/dsh-deepseek-chat",
    factory: (require2) => {
      const React = require2("react");
      const h = React.createElement;
      const { useEffect, useRef, useState } = React;
      const NS = "dsh-deepseek-chat";
      const CONFIG_URL = "/dsh-deepseek-chat/config";
      const zh = {
        "view.webchat": "网页对话",
        "action.reload": "刷新",
        "action.openExternal": "在浏览器打开",
        "state.loading": "正在连接 DeepSeek 网页版…",
        "state.error": "无法连接本地代理服务",
        "state.retry": "重试",
        "state.notice": "由本地代理嵌入 chat.deepseek.com；第三方账号登录（Google 等）请在浏览器中完成"
      };
      const en = {
        "view.webchat": "Web Chat",
        "action.reload": "Reload",
        "action.openExternal": "Open in Browser",
        "state.loading": "Connecting to DeepSeek Web…",
        "state.error": "Cannot reach the local proxy",
        "state.retry": "Retry",
        "state.notice": "Embedded via a local proxy to chat.deepseek.com; sign in with third-party accounts (e.g. Google) in a browser tab"
      };
      const CSS = [
        ".dshdc-root{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;display:flex;overflow:hidden}",
        ".dshdc-root *{box-sizing:border-box}",
        ".dshdc-header{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:none;align-items:center;gap:10px;min-height:44px;padding:0 14px;display:flex}",
        ".dshdc-title{font-size:14px;font-weight:600;flex:none}",
        ".dshdc-sub{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:11px;text-overflow:ellipsis;white-space:nowrap;flex:1;overflow:hidden}",
        ".dshdc-btn{cursor:pointer;height:26px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1);border-radius:7px;flex:none;align-items:center;gap:5px;padding:0 10px;font:inherit;font-size:12px;display:inline-flex}",
        ".dshdc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshdc-btn:disabled{cursor:not-allowed;opacity:.45}",
        ".dshdc-frameWrap{position:relative;min-height:0;flex:1;background:#fff}",
        ".dshdc-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}",
        ".dshdc-overlay{position:absolute;inset:0;z-index:1;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;justify-content:center;align-items:center;gap:12px;display:flex}",
        ".dshdc-spinner{width:22px;height:22px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:dshdc-spin .8s linear infinite}",
        "@keyframes dshdc-spin{to{transform:rotate(360deg)}}",
        ".dshdc-notice{border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-1);flex:none;padding:4px 14px;font-size:11px;text-align:center}"
      ].join("\n");
      let persistent = null;
      function ensurePersistent(url) {
        if (persistent !== null) return persistent;
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
        const frame = document.createElement("iframe");
        frame.className = "dshdc-frame";
        frame.setAttribute("allow", "clipboard-read; clipboard-write");
        frame.src = url;
        wrap.appendChild(frame);
        document.body.appendChild(wrap);
        persistent = { wrap, frame, url };
        return persistent;
      }
      function detachPersistent() {
        if (persistent === null) return;
        persistent.wrap.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
        if (persistent.wrap.parentElement !== document.body) document.body.appendChild(persistent.wrap);
      }
      function ChatView() {
        const [status, setStatus] = useState(() => persistent !== null ? "ready" : "loading");
        const [url, setUrl] = useState(() => persistent?.url ?? "");
        const [frameLoaded, setFrameLoaded] = useState(() => persistent !== null);
        const [reloadKey, setReloadKey] = useState(0);
        const stageRef = useRef(null);
        const t = ChatView.t ?? ((key) => key);
        useEffect(() => {
          if (persistent !== null) return;
          let cancelled = false;
          setStatus("loading");
          fetch(CONFIG_URL, { cache: "no-store" }).then((res) => {
            if (!res.ok) throw new Error("config http " + res.status);
            return res.json();
          }).then((json) => {
            if (cancelled) return;
            if (typeof json.url !== "string" || json.url.length === 0) throw new Error("config missing url");
            setUrl(json.url);
            setStatus("ready");
          }).catch(() => {
            if (!cancelled) setStatus("error");
          });
          return () => {
            cancelled = true;
          };
        }, [reloadKey]);
        useEffect(() => {
          if (status !== "ready") return;
          const stage = stageRef.current;
          if (stage === null) return;
          const entry = ensurePersistent(url);
          entry.wrap.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
          stage.appendChild(entry.wrap);
          const onLoad = () => setFrameLoaded(true);
          entry.frame.addEventListener("load", onLoad);
          if (entry.frame.contentWindow !== null && entry.frame.contentWindow.document?.readyState === "complete") {
            setFrameLoaded(true);
          }
          return () => {
            entry.frame.removeEventListener("load", onLoad);
            detachPersistent();
          };
        }, [status, url, reloadKey]);
        const header = h(
          "div",
          { className: "dshdc-header" },
          h("span", { className: "dshdc-title" }, t("view.webchat")),
          h("span", { className: "dshdc-sub" }, "chat.deepseek.com"),
          h("button", {
            type: "button",
            className: "dshdc-btn",
            disabled: status !== "ready",
            onClick: () => {
              if (persistent !== null && persistent.url === url) {
                setFrameLoaded(false);
                persistent.frame.contentWindow?.location.reload();
              } else if (persistent !== null) {
                persistent.frame.src = url;
                persistent.url = url;
                setFrameLoaded(false);
              } else {
                setReloadKey((n) => n + 1);
              }
            }
          }, t("action.reload")),
          h("button", {
            type: "button",
            className: "dshdc-btn",
            disabled: status !== "ready",
            onClick: () => window.open(url, "_blank", "noopener")
          }, t("action.openExternal"))
        );
        let body;
        if (status === "error") {
          body = h(
            "div",
            { className: "dshdc-overlay", style: { position: "relative", flex: "1" } },
            h("div", null, t("state.error")),
            h("button", { type: "button", className: "dshdc-btn", onClick: () => setReloadKey((n) => n + 1) }, t("state.retry"))
          );
        } else {
          body = h(
            "div",
            { className: "dshdc-frameWrap", ref: stageRef },
            (!frameLoaded || status === "loading") && h(
              "div",
              { className: "dshdc-overlay" },
              h("div", { className: "dshdc-spinner" }),
              h("div", null, t("state.loading"))
            )
          );
        }
        return h(
          "div",
          { className: "dshdc-root" },
          header,
          body,
          h("div", { className: "dshdc-notice" }, t("state.notice"))
        );
      }
      const inject = ["slots", "locale"];
      function apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
        const t = ctx.locale.bind(NS);
        ChatView.t = t;
        ctx.effect(() => {
          const tag = document.createElement("style");
          tag.dataset.plugin = "@local/dsh-deepseek-chat";
          tag.dataset.pluginCss = NS;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, "deepseek-chat: styles");
        ctx.slots.inject("conversation.view", () => ctx.slots.register({
          name: "conversation.view",
          id: "webchat",
          order: 30,
          locale: NS,
          label: () => t("view.webchat"),
          inject: () => ({})
        }, ChatView));
      }
      return { apply, inject };
    }
  });
})();
