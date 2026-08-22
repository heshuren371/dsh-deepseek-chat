/**
 * dsh Web 客户端运行时的环境声明。
 *
 * 客户端产物是经由浏览器模块系统（window.__ModuleLoader__）加载的
 * 普通脚本；require 是 loader 传给插件 factory 的参数，React 由运行时
 * 的外部模块表提供——与宿主内置插件遵循同一契约。
 */

interface ModuleLoaderRegistration {
  id: string;
  factory: (require: ModuleRequire) => unknown;
}

interface ModuleRequire {
  (id: 'react'): typeof import('react');
  (id: 'react-dom/client'): typeof import('react-dom/client');
  (id: string): any;
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
