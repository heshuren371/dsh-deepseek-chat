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
 * 只剩顶部中央的胶囊。刷新交给浏览器或宿主自己的重载。
 *
 * iframe 是全局单例，切换模式只改覆盖层可见性，不重建也不搬动它——理由见
 * persistent 的注释。
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-deepseek-chat",
  factory: () => {
    const NS = "dsh-deepseek-chat";
    const CONFIG_URL = "/dsh-deepseek-chat/config";
    const ACTIVITY_URL = "/dsh-deepseek-chat/activity";

    /** DSH 客户端活动服务里本插件读取的字段。 */
    interface ActivityRow {
      running?: boolean;
      pendingInteraction?: { kind: string };
      completionUnread: boolean;
    }

    interface ActivitySource {
      getSnapshot(): ReadonlyMap<string, ActivityRow>;
      subscribe(fn: () => void): () => void;
    }

    type ShortcutModifier = "primary" | "control" | "alt" | "shift" | "meta";
    type ShortcutProfile = "desktop:macos" | "desktop:windows" | "desktop:linux" | "web:macos" | "web:windows" | "web:linux";

    interface ShortcutBinding {
      code: string;
      secondCode?: string;
      modifiers: readonly ShortcutModifier[];
    }

    interface ShortcutCommand {
      id: string;
      label: () => string;
      aliases: readonly string[];
      defaults: Readonly<Partial<Record<ShortcutProfile, ShortcutBinding>>>;
      regions: readonly ("page" | "editable" | "terminal")[];
      modals: readonly string[];
      resolve(context: {
        source?: "keyboard" | "menu" | "iframe" | "webview";
        region: "page" | "editable" | "terminal";
        modal: string | null;
        target: Element | null;
      }): { status: "handled"; run(): void } | { status: "blocked"; reason: string } | { status: "pass" };
    }

    interface ShortcutService {
      register(command: ShortcutCommand): () => void;
    }

    /** 可选子 fiber 的 scope：只声明本插件读取的服务。 */
    interface ClientScope {
      effect(fn: () => unknown, label?: string): unknown;
      uiSession?: {
        sessionStatus?: ActivitySource;
        pendingInteractions?: ActivitySource;
      };
      shortcuts?: ShortcutService;
    }

    /** 客户端 cordis 上下文里本插件实际用到的那几个方法。 */
    interface ClientContext {
      effect(fn: () => unknown, label?: string): unknown;
      /** 可选子 fiber：服务缺失时回调不执行，父插件照常运行。 */
      inject?(deps: string[], cb: (scope: ClientScope) => void): unknown;
      locale: {
        register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): unknown;
        bind(namespace: string): (key: string) => string;
      };
    }

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
      "state.retry": "重试",
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
      "state.retry": "Retry",
    };

    /**
     * DSH 帧内元素最高 z-index 20，账户提示 40，引导页 900，设置弹窗 1000。
     * 覆盖层取 500：盖住整个应用，把模态弹窗留给 DSH；胶囊取 501，任何状态下
     * 都能切回「对话」。
     */
    const CSS = [
      // 胶囊落在窗口顶部 chrome 带里（macOS 48px 安全区 / Windows 标题栏），居中
      // 不碰两侧控件；空闲只露 aria-pressed="true" 那一段，另一段收成零宽但不出
      // DOM、不退 Tab 顺序，悬停或 :focus-within 时两段一起展开。
      ".dshdc-switch{position:fixed;z-index:501;top:max(10px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:0;--dshdc-open-gap:2px;transition:gap 150ms ease;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px #00000012,0 6px 18px #00000012;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}",
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
      "[data-doc-hidden] .dshdc-dot,[data-doc-hidden] .dshdc-switch[data-streaming='true']::after{animation-play-state:paused}",
    ].join("\n");

    function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
      const node = document.createElement(tag);
      if (className !== undefined) node.className = className;
      return node;
    }

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
    /** 当前 effect 实例的重绘钩子（HMR 后指向最新实例）。 */
    let notify: (() => void) | null = null;
    /** 当前 effect 实例的模式切换动作（快捷键入口）。 */
    let toggleChat: (() => void) | null = null;

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
        notify?.();
      });
      wrap.appendChild(frame);
      persistent = { wrap, frame, url };
      return persistent;
    }

    /** DSH 全局活动状态：任一 session 运行中 / 有 approval 待处理 / 有完成待读。 */
    let activityRunning = false;
    let activityApproval = false;
    let activityCompleted = false;

    /**
     * 订阅 DSH 客户端活动状态，派生成上面三个布尔并回调。
     * inject 或 uiSession 服务不可用、形状不符时静默保持无活动状态。
     */
    function watchActivity(ctx: ClientContext, onChange: () => void): void {
      // 属性读取也放进 try：动态包形态下 guard 会把读未声明属性变成抛错。
      try {
        if (typeof ctx.inject !== "function") return;
        ctx.inject(["uiSession"], (scope) => {
          try {
            const source = scope.uiSession?.sessionStatus ?? scope.uiSession?.pendingInteractions;
            if (typeof source?.getSnapshot !== "function" || typeof source?.subscribe !== "function") return;
            const recompute = (): void => {
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
            // 服务实现异常时不显示活动状态
          }
        });
      } catch {
        // 宿主拒绝注入时不显示活动状态
      }
    }

    /** 覆盖模式只保留 locale。 */
    const inject = ["locale"];

    /**
     * 注册模式切换命令。快捷键服务缺失、形状不符或注册冲突（重名 / 保留键 /
     * 默认绑定重叠）时静默放弃。键盘监听在宿主 document 上，焦点在跨源 iframe
     * 内时收不到，命令主要用于从「对话」进入 CHAT。
     */
    function watchShortcut(ctx: ClientContext, t: (key: string) => string): void {
      try {
        if (typeof ctx.inject !== "function") return;
        ctx.inject(["shortcuts"], (scope) => {
          try {
            const service = scope.shortcuts;
            if (service === undefined || typeof service.register !== "function") return;
            const register = (): (() => void) | undefined => {
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
                    "web:windows": { code: "KeyJ", modifiers: ["primary", "alt"] },
                  },
                  regions: ["page", "editable", "terminal"],
                  modals: [],
                  resolve: () => toggleChat === null
                    ? { status: "pass" }
                    : { status: "handled", run: () => { toggleChat?.(); } },
                });
              } catch {
                return undefined;
              }
            };
            scope.effect(register, "deepseek-chat: toggle command");
          } catch {
            // 服务实现异常时不提供快捷键
          }
        });
      } catch {
        // 宿主拒绝注入时不提供快捷键
      }
    }

    function apply(ctx: ClientContext): void {
      // 活动状态是全局聚合：重挂载从空开始，等订阅首次快照回填。
      activityRunning = false;
      activityApproval = false;
      activityCompleted = false;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
      const t: (key: string) => string = ctx.locale.bind(NS);

      ctx.effect(() => {
        let disposed = false;
        let active = false;
        let status: "idle" | "loading" | "ready" | "error" = "idle";
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
            if (child === host) continue;
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

        /** 活动状态文案，按 approval > running > completed 取最高优先级。 */
        const activityText = (): string => {
          if (activityApproval) return t("activity.approval");
          if (activityRunning) return t("activity.running");
          if (activityCompleted) return t("activity.completed");
          return "";
        };

        const switcherLabel = (): string => {
          const parts = [t("mode.switch")];
          const activity = activityText();
          if (activity !== "") parts.push(activity);
          if (streaming) parts.push(t("activity.streaming"));
          return parts.join(" · ");
        };

        /** 状态点的可访问名称：CHAT 模式下带上动作，对话模式下只报状态。 */
        const dotLabel = (): string => {
          const activity = activityText();
          if (!active) return activity;
          const parts = [t("activity.jump")];
          if (activity !== "") parts.push(activity);
          if (streaming) parts.push(t("activity.streaming"));
          return parts.join(" · ");
        };

        const render = (): void => {
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

        /** 生成中状态来自 Host SSE；出错即关闭不重连，连接随 effect 关闭。 */
        let eventSource: EventSource | null = null;
        if (typeof EventSource !== "undefined") {
          try {
            const es = new EventSource(ACTIVITY_URL);
            eventSource = es;
            es.onmessage = (event: MessageEvent): void => {
              if (disposed) return;
              let next = false;
              try {
                next = (JSON.parse(String(event.data)) as { streaming?: unknown }).streaming === true;
              } catch {
                return;
              }
              if (next === streaming) return;
              streaming = next;
              render();
            };
            es.onerror = (): void => {
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

        toggleChat = (): void => {
          if (active) leave();
          else enter();
        };

        const onKeyDown = (event: KeyboardEvent): void => {
          // iframe 内的按键不会冒泡到这里，仅在焦点还在宿主页面时生效
          if (event.key === "Escape" && active) leave();
        };

        /** 文档不可见时暂停脉动；可见性切换挂在胶囊的 data-doc-hidden 上。 */
        const onVisibilityChange = (): void => {
          if (document.hidden) switcher.dataset.docHidden = "";
          else delete switcher.dataset.docHidden;
        };
        onVisibilityChange();

        dshSeg.addEventListener("click", leave);
        chatSeg.addEventListener("click", enter);
        dot.addEventListener("click", leave);
        retryBtn.addEventListener("click", load);
        window.addEventListener("keydown", onKeyDown);
        document.addEventListener("visibilitychange", onVisibilityChange);
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
          setInert(false);
          host.remove();
          style.remove();
        };
      }, "deepseek-chat: chat mode");

      watchActivity(ctx, () => notify?.());
      watchShortcut(ctx, t);
    }

    return { apply, inject };
  },
});
