"use strict";
(() => {
  // src/client/client-main.ts
  window.__ModuleLoader__.load({
    id: "@local/dsh-deepseek-chat",
    factory: () => {
      const NS = "dsh-deepseek-chat";
      const CONFIG_URL = "/dsh-deepseek-chat/config";
      const ACTIVITY_URL = "/dsh-deepseek-chat/activity";
      const zh = {
        "mode.switch": "视图切换",
        "mode.dsh": "对话",
        "mode.chat": "CHAT",
        "activity.running": "DSH 运行中",
        "activity.approval": "DSH 待审批",
        "activity.completed": "DSH 已完成待查看",
        "activity.jump": "切回对话查看",
        "activity.streaming": "DeepSeek 生成中",
        "command.toggle": "切换 CHAT 模式",
        "state.loading": "正在连接 DeepSeek 网页版…",
        "state.error": "无法连接本地代理服务",
        "state.retry": "重试"
      };
      const en = {
        "mode.switch": "View switch",
        "mode.dsh": "Conversation",
        "mode.chat": "CHAT",
        "activity.running": "DSH running",
        "activity.approval": "DSH approval pending",
        "activity.completed": "DSH completed, unread",
        "activity.jump": "Back to conversation",
        "activity.streaming": "DeepSeek generating",
        "command.toggle": "Toggle CHAT mode",
        "state.loading": "Connecting to DeepSeek Web…",
        "state.error": "Cannot reach the local proxy",
        "state.retry": "Retry"
      };
      const CSS = [
        // 胶囊落在窗口顶部 chrome 带里（macOS 48px 安全区 / Windows 标题栏），居中
        // 不碰两侧控件；空闲只露 aria-pressed="true" 那一段，另一段收成零宽但不出
        // DOM、不退 Tab 顺序，悬停或 :focus-within 时两段一起展开。
        ".dshdc-switch{position:fixed;z-index:501;top:max(10px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:0;--dshdc-open-gap:2px;transition:gap 150ms ease;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag;touch-action:none;cursor:grab}",
        // 拖动中换成抓取光标；不引入任何位移动画。
        ".dshdc-switch[data-dragging]{cursor:grabbing}",
        ".dshdc-switch[data-dragging] .dshdc-seg,.dshdc-switch[data-dragging] .dshdc-dot{cursor:grabbing}",
        // Windows 桌面端顶部 40px 是原生标题栏 + 窗口拖拽区（titleBarOverlay 加
        // .frame::before 的 drag）。Electron 按几何合成拖拽区、不认 z-index，浮层
        // 落在带内点击会被拿去拖窗口，所以整枚胶囊下移到标题栏之下——与 DSH
        // dockkit 浮层的做法一致。全屏没有可拖的标题栏，保持原位。
        "html[data-windows-titlebar]:not([data-fullscreen]) .dshdc-switch{top:calc(var(--dsh-windows-titlebar-height,40px) + 8px)}",
        ".dshdc-switch:hover,.dshdc-switch:focus-within{gap:var(--dshdc-open-gap)}",
        // DeepSeek 生成中：胶囊外圈一道 1px 呼吸环；降低动效时保持静态环。
        ".dshdc-switch[data-streaming='true']::after{content:'';position:absolute;inset:-1px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:999px;pointer-events:none;animation:dshdc-breathe 2s ease-in-out infinite}",
        "@keyframes dshdc-breathe{0%,100%{opacity:1}50%{opacity:.35}}",
        ".dshdc-seg{display:inline-flex;align-items:center;height:26px;max-width:160px;padding:0 var(--dshdc-seg-pad,12px);border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;overflow:hidden;-webkit-app-region:no-drag;transition:max-width 150ms ease,opacity 150ms ease,padding 150ms ease}",
        // 收起的段零宽、透明，但仍是按钮：读屏可读，展开后下一次 Tab 可达。
        ".dshdc-seg[aria-pressed='false']{max-width:0;padding:0;opacity:0}",
        ".dshdc-switch:hover .dshdc-seg[aria-pressed='false'],.dshdc-switch:focus-within .dshdc-seg[aria-pressed='false']{max-width:160px;padding:0 var(--dshdc-seg-pad,12px);opacity:1}",
        // 活动点：无活动状态时零宽透明；运行中脉动，待审批与完成待读常亮。
        // hidden 只标记无活动状态，显隐交给 width / opacity，display:none 会打断过渡。
        ".dshdc-dot{display:inline-block;position:relative;padding:0;border:0;font:inherit;cursor:pointer;-webkit-app-region:no-drag;width:0;height:6px;margin-right:0;border-radius:50%;background:var(--dsw-alias-state-business-primary);opacity:0;transition:width 150ms ease,margin-right 150ms ease,opacity 150ms ease}",
        // 可点时把命中区扩到 24×24（WCAG 2.5.8）；只在 CHAT 模式下生效，避免挡住分段。
        ".dshdc-dot:not(:disabled)::before{content:'';position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%)}",
        ".dshdc-dot[data-state='running']{width:6px;margin-right:6px;opacity:1;animation:dshdc-pulse 1.6s ease-in-out infinite}",
        ".dshdc-dot[data-state='approval']{width:6px;margin-right:6px;opacity:1;background:var(--dsw-alias-state-warn-primary)}",
        ".dshdc-dot[data-state='completed']{width:6px;margin-right:6px;opacity:1;background:var(--dsw-alias-state-success-primary)}",
        "@keyframes dshdc-pulse{0%,100%{opacity:1}50%{opacity:.4}}",
        ".dshdc-seg:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshdc-seg[aria-pressed='true'],.dshdc-seg[aria-pressed='true']:hover{background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-foreground)}",
        ".dshdc-seg:focus-visible,.dshdc-btn:focus-visible,.dshdc-dot:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
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
        "@media (max-width:480px){.dshdc-switch{padding:2px}.dshdc-seg{--dshdc-seg-pad:9px;height:24px;font-size:11px}}",
        "@media (max-width:420px){.dshdc-switch{--dshdc-open-gap:1px}.dshdc-seg{--dshdc-seg-pad:7px;font-size:10px}}",
        // 降低动效偏好下取消过渡与动画；文档不可见时暂停脉动。
        "@media (prefers-reduced-motion: reduce){.dshdc-switch,.dshdc-seg,.dshdc-dot{transition:none}.dshdc-dot[data-state='running'],.dshdc-spinner,.dshdc-switch[data-streaming='true']::after{animation:none}}",
        "[data-doc-hidden] .dshdc-dot,[data-doc-hidden] .dshdc-switch[data-streaming='true']::after{animation-play-state:paused}"
      ].join("\n");
      function el(tag, className) {
        const node = document.createElement(tag);
        if (className !== void 0) node.className = className;
        return node;
      }
      let persistent = null;
      let frameLoaded = false;
      let notify = null;
      let toggleChat = null;
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
      let activityRunning = false;
      let activityApproval = false;
      let activityCompleted = false;
      function watchActivity(ctx, onChange) {
        try {
          if (typeof ctx.inject !== "function") return;
          ctx.inject(["uiSession"], (scope) => {
            try {
              const source = scope.uiSession?.sessionStatus ?? scope.uiSession?.pendingInteractions;
              if (typeof source?.getSnapshot !== "function" || typeof source?.subscribe !== "function") return;
              const recompute = () => {
                let running = false;
                let approval = false;
                let completed = false;
                try {
                  for (const row of source.getSnapshot().values()) {
                    if (row.running === true) running = true;
                    if (row.pendingInteraction?.kind === "approval") approval = true;
                    if (row.completionUnread === true) completed = true;
                  }
                } catch {
                  return;
                }
                activityRunning = running;
                activityApproval = approval;
                activityCompleted = completed;
                onChange();
              };
              scope.effect(() => {
                recompute();
                return source.subscribe(recompute);
              }, "deepseek-chat: dsh activity");
            } catch {
            }
          });
        } catch {
        }
      }
      const inject = ["locale"];
      function watchShortcut(ctx, t) {
        try {
          if (typeof ctx.inject !== "function") return;
          ctx.inject(["shortcuts"], (scope) => {
            try {
              const service = scope.shortcuts;
              if (service === void 0 || typeof service.register !== "function") return;
              const register = () => {
                try {
                  return service.register({
                    id: "deepseek-chat.toggle",
                    label: () => t("command.toggle"),
                    aliases: ["toggle chat", "switch chat", "deepseek chat"],
                    defaults: {
                      "desktop:macos": { code: "KeyJ", modifiers: ["primary", "alt"] },
                      "desktop:windows": { code: "KeyJ", modifiers: ["primary", "alt"] },
                      "desktop:linux": { code: "KeyJ", modifiers: ["primary", "alt"] },
                      "web:macos": { code: "KeyJ", modifiers: ["primary", "alt"] },
                      "web:windows": { code: "KeyJ", modifiers: ["primary", "alt"] }
                    },
                    regions: ["page", "editable", "terminal"],
                    modals: [],
                    resolve: () => toggleChat === null ? { status: "pass" } : { status: "handled", run: () => {
                      toggleChat?.();
                    } }
                  });
                } catch {
                  return void 0;
                }
              };
              scope.effect(register, "deepseek-chat: toggle command");
            } catch {
            }
          });
        } catch {
        }
      }
      function apply(ctx) {
        activityRunning = false;
        activityApproval = false;
        activityCompleted = false;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
        const t = ctx.locale.bind(NS);
        ctx.effect(() => {
          let disposed = false;
          let active = false;
          let status = "idle";
          let url = "";
          let streaming = false;
          const style = document.createElement("style");
          style.dataset.plugin = "@local/dsh-deepseek-chat";
          style.dataset.pluginCss = NS;
          style.textContent = CSS;
          document.head.appendChild(style);
          const host = el("div", "dshdc-host");
          const switcher = el("div", "dshdc-switch");
          switcher.setAttribute("role", "group");
          const dot = el("button", "dshdc-dot");
          dot.type = "button";
          dot.hidden = true;
          const dshSeg = el("button", "dshdc-seg");
          dshSeg.type = "button";
          dshSeg.textContent = t("mode.dsh");
          const chatSeg = el("button", "dshdc-seg");
          chatSeg.type = "button";
          chatSeg.textContent = t("mode.chat");
          switcher.append(dot, dshSeg, chatSeg);
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
          const activityText = () => {
            if (activityApproval) return t("activity.approval");
            if (activityRunning) return t("activity.running");
            if (activityCompleted) return t("activity.completed");
            return "";
          };
          const switcherLabel = () => {
            const parts = [t("mode.switch")];
            const activity = activityText();
            if (activity !== "") parts.push(activity);
            if (streaming) parts.push(t("activity.streaming"));
            return parts.join(" · ");
          };
          const dotLabel = () => {
            const activity = activityText();
            if (!active) return activity;
            const parts = [t("activity.jump")];
            if (activity !== "") parts.push(activity);
            if (streaming) parts.push(t("activity.streaming"));
            return parts.join(" · ");
          };
          const render = () => {
            dshSeg.setAttribute("aria-pressed", String(!active));
            chatSeg.setAttribute("aria-pressed", String(active));
            const hasActivity = activityRunning || activityApproval || activityCompleted;
            dot.hidden = !hasActivity;
            dot.setAttribute("aria-hidden", String(!hasActivity));
            dot.dataset.state = activityApproval ? "approval" : activityRunning ? "running" : activityCompleted ? "completed" : "";
            dot.disabled = !hasActivity || !active;
            dot.tabIndex = dot.disabled ? -1 : 0;
            const jump = dotLabel();
            dot.setAttribute("aria-label", jump);
            dot.title = jump;
            switcher.setAttribute("aria-label", switcherLabel());
            if (streaming) switcher.dataset.streaming = "true";
            else delete switcher.dataset.streaming;
            if (active) delete overlay.dataset.idle;
            else overlay.dataset.idle = "";
            const pending = active && (status !== "ready" || !frameLoaded);
            state.hidden = !pending;
            spinner.hidden = status !== "loading" && status !== "ready";
            stateText.textContent = status === "error" ? t("state.error") : t("state.loading");
            retryBtn.hidden = status !== "error";
          };
          let eventSource = null;
          if (typeof EventSource !== "undefined") {
            try {
              const es = new EventSource(ACTIVITY_URL);
              eventSource = es;
              es.onmessage = (event) => {
                if (disposed) return;
                let next = false;
                try {
                  next = JSON.parse(String(event.data)).streaming === true;
                } catch {
                  return;
                }
                if (next === streaming) return;
                streaming = next;
                render();
              };
              es.onerror = () => {
                if (disposed) return;
                es.close();
                if (eventSource === es) eventSource = null;
                streaming = false;
                render();
              };
            } catch {
              eventSource = null;
            }
          }
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
          toggleChat = () => {
            if (active) leave();
            else enter();
          };
          const onKeyDown = (event) => {
            if (event.key === "Escape" && active) leave();
          };
          const onVisibilityChange = () => {
            if (document.hidden) switcher.dataset.docHidden = "";
            else delete switcher.dataset.docHidden;
          };
          onVisibilityChange();
          const POS_STORAGE = "dshdc.capsule.position";
          let drag = null;
          let swallowClick = false;
          const windowsBand = () => {
            const root = document.documentElement;
            if (!root.hasAttribute("data-windows-titlebar") || root.hasAttribute("data-fullscreen")) return 0;
            const raw = Number.parseFloat(getComputedStyle(root).getPropertyValue("--dsh-windows-titlebar-height"));
            return Number.isFinite(raw) ? raw : 40;
          };
          const clampPosition = (centerX, top) => {
            const rect = switcher.getBoundingClientRect();
            const half = rect.width / 2;
            const minY = windowsBand();
            return {
              x: Math.min(Math.max(centerX, half), Math.max(half, window.innerWidth - half)),
              y: Math.min(Math.max(top, minY), Math.max(minY, window.innerHeight - rect.height))
            };
          };
          const placeCapsule = (centerX, top) => {
            const next = clampPosition(centerX, top);
            switcher.style.left = `${next.x}px`;
            switcher.style.top = `${next.y}px`;
          };
          const rememberCapsule = () => {
            try {
              const rect = switcher.getBoundingClientRect();
              localStorage.setItem(POS_STORAGE, JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top }));
            } catch {
            }
          };
          const restoreCapsule = () => {
            try {
              const raw = localStorage.getItem(POS_STORAGE);
              if (raw === null) return;
              const saved = JSON.parse(raw);
              if (typeof saved.x === "number" && typeof saved.y === "number") placeCapsule(saved.x, saved.y);
            } catch {
            }
          };
          const onPointerDown = (event) => {
            if (event.button !== 0) return;
            const rect = switcher.getBoundingClientRect();
            drag = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: rect.left + rect.width / 2,
              originY: rect.top,
              moved: false
            };
            swallowClick = false;
            if (typeof switcher.setPointerCapture === "function" && event.pointerId !== void 0) {
              try {
                switcher.setPointerCapture(event.pointerId);
              } catch {
              }
            }
          };
          const onPointerMove = (event) => {
            if (drag === null || event.pointerId !== drag.pointerId) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (!drag.moved) {
              if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
              drag.moved = true;
              switcher.dataset.dragging = "";
            }
            placeCapsule(drag.originX + dx, drag.originY + dy);
          };
          const onPointerEnd = (event) => {
            if (drag === null || event.pointerId !== drag.pointerId) return;
            const moved = drag.moved;
            drag = null;
            if (typeof switcher.hasPointerCapture === "function" && typeof switcher.releasePointerCapture === "function" && event.pointerId !== void 0) {
              try {
                if (switcher.hasPointerCapture(event.pointerId)) switcher.releasePointerCapture(event.pointerId);
              } catch {
              }
            }
            delete switcher.dataset.dragging;
            if (!moved) return;
            swallowClick = true;
            rememberCapsule();
          };
          const onClickCapture = (event) => {
            if (!swallowClick) return;
            swallowClick = false;
            event.stopPropagation();
            event.preventDefault();
          };
          const onWindowResize = () => {
            if (switcher.style.left === "" && switcher.style.top === "") return;
            const rect = switcher.getBoundingClientRect();
            placeCapsule(rect.left + rect.width / 2, rect.top);
          };
          const onContextMenu = (event) => {
            event.preventDefault();
            try {
              localStorage.removeItem(POS_STORAGE);
            } catch {
            }
            switcher.style.left = "";
            switcher.style.top = "";
          };
          dshSeg.addEventListener("click", leave);
          chatSeg.addEventListener("click", enter);
          dot.addEventListener("click", leave);
          retryBtn.addEventListener("click", load);
          window.addEventListener("keydown", onKeyDown);
          document.addEventListener("visibilitychange", onVisibilityChange);
          switcher.addEventListener("pointerdown", onPointerDown);
          switcher.addEventListener("pointermove", onPointerMove);
          switcher.addEventListener("pointerup", onPointerEnd);
          switcher.addEventListener("pointercancel", onPointerEnd);
          switcher.addEventListener("click", onClickCapture, true);
          switcher.addEventListener("contextmenu", onContextMenu);
          window.addEventListener("resize", onWindowResize);
          restoreCapsule();
          notify = render;
          render();
          return () => {
            disposed = true;
            eventSource?.close();
            eventSource = null;
            toggleChat = null;
            notify = null;
            dshSeg.removeEventListener("click", leave);
            chatSeg.removeEventListener("click", enter);
            dot.removeEventListener("click", leave);
            retryBtn.removeEventListener("click", load);
            window.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            switcher.removeEventListener("pointerdown", onPointerDown);
            switcher.removeEventListener("pointermove", onPointerMove);
            switcher.removeEventListener("pointerup", onPointerEnd);
            switcher.removeEventListener("pointercancel", onPointerEnd);
            switcher.removeEventListener("click", onClickCapture, true);
            switcher.removeEventListener("contextmenu", onContextMenu);
            window.removeEventListener("resize", onWindowResize);
            setInert(false);
            host.remove();
            style.remove();
          };
        }, "deepseek-chat: chat mode");
        watchActivity(ctx, () => notify?.());
        watchShortcut(ctx, t);
      }
      return { apply, inject };
    }
  });
})();
