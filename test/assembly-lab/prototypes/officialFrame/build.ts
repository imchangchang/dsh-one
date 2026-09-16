/**
 * 原型形态插件的打包（#89 原型）：与 `build.mjs` 打自有插件**同一套格式**——
 * esbuild 打成自注册 IIFE，banner/footer 包出 `window.__ModuleLoader__.load({id, factory})`，
 * `react` / `react/jsx-runtime` / cordis / client-store / 官方原语留 external
 * （运行时由主 bundle 的种子表满足）。
 *
 * 产物落在 `test/assembly-lab/out/`（gitignored），不碰生产的 `dist/assembly/plugins/`
 * ——生产插件的打包入口是 build.mjs，原型不往里加东西（避免动共享文件）。
 */
import esbuild from 'esbuild'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTO_PLUGINS } from './trees.ts'

const DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * 把三个原型插件打出来，放进 `pluginsDir`（= mirror 的插件目录）。
 *
 * 为什么直接落在生产的 `dist/assembly/plugins/` 而不是实验室的 out 目录：mirror 只有
 * 一个 `pluginsDir`，而原型三棵树同时要取**生产自有插件**（theme-follow / workspace-tree
 * 等，随生产 block list 一起来）与**原型插件**——放一个目录里最省事。dist 是构建产物
 * （`npm run build` 每次 `rm -rf dist/assembly` 会连它们一起清掉），不会被提交。
 */
export async function buildProtoPlugins(pluginsDir: string): Promise<string> {
  for (const plugin of PROTO_PLUGINS) {
    const pluginDir = path.join(pluginsDir, plugin.id)
    await fsp.mkdir(pluginDir, { recursive: true })
    await esbuild.build({
      entryPoints: [path.join(DIR, plugin.entry)],
      outfile: path.join(pluginDir, 'client.js'),
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      external: [
        'react',
        'react/jsx-runtime',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-store',
        '@deepseek-ai/dsh-client-ui-primitives',
      ],
      banner: {
        js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(plugin.id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
      },
      footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
      logLevel: 'warning',
    })
  }
  return pluginsDir
}
