/**
 * dsh Web 客户端运行时的环境声明。
 *
 * 客户端产物是经由浏览器模块系统（window.__ModuleLoader__）加载的普通
 * 脚本：插件把自己的 id 与 factory 交给 loader，宿主运行时调用 factory
 * 拿到模块导出（apply / inject）后挂载到客户端 cordis 树上。
 */

interface ModuleLoaderRegistration {
  id: string;
  factory: () => unknown;
}

interface ModuleLoader {
  mode: string;
  pendingQueue?: ModuleLoaderRegistration[];
  load(registration: ModuleLoaderRegistration): void;
}

interface Window {
  __ModuleLoader__: ModuleLoader;
  __DSH_BOOT__?: unknown;
}
