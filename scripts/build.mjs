/**
 * @local/dsh-deepseek-chat 构建管线。
 *
 * 产物（lib/）：
 *  - lib/client.js  客户端插件（IIFE，经 __ModuleLoader__ 注册）
 *  - lib/index.js   Host 插件（ESM，node 内置模块保持外部引用）
 */
import { build } from 'esbuild';

const common = {
  logLevel: 'info',
  target: 'es2020',
  charset: 'utf8',
};

async function main() {
  await build({
    ...common,
    entryPoints: ['src/client/client-main.ts'],
    bundle: true,
    format: 'iife',
    outfile: 'lib/client.js',
  });

  await build({
    ...common,
    entryPoints: ['src/host/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    outfile: 'lib/index.js',
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
