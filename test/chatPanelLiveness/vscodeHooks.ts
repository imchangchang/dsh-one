/**
 * 宿主侧 harness 的模块钩子（`module.registerHooks`，同步、不开 worker）。
 *
 * 两件事：
 *
 * 1. **把裸模块名 `vscode` 指到 `vscodeStub.ts`**——真扩展宿主里才有那个模块
 *    （与 `test/install-guide/`、`test/legacy-sidebar/` 同一套做法）；
 * 2. **`.ts` 先转一遍再交给 Node**。为什么不用 Node 自带的类型擦除：`src/ui/assemblyView.ts`
 *    里有 TS 的**参数属性**（`constructor(private readonly x)` 这种简写），而 strip-only
 *    模式明确不支持它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。选择在这里转，而不是把生产
 *    代码改成普通字段：测试基建不该反过来要求生产代码改形。
 *    用的是 Node 自带的 `stripTypeScriptTypes(..., { mode: 'transform' })`（就是
 *    `--experimental-transform-types` 那一档，支持参数属性）——**不要**换成 esbuild 的
 *    `transformSync`：它会起一个常驻的 service 子进程，`node --test` 跑完用例后进程不退出
 *    （实测整轮挂住）。
 *
 * 用同步钩子而不是 `module.register()`：后者会开一个 loader worker 线程，同样会让跑完的
 * 测试进程不退出（实测）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const VSCODE_STUB = new URL('./vscodeStub.ts', import.meta.url).href

export function resolveSpecifier(specifier: string, context: unknown, nextResolve: Function): unknown {
  if (specifier === 'vscode') return { url: VSCODE_STUB, shortCircuit: true }
  return nextResolve(specifier, context)
}

export function loadSource(url: string, context: unknown, nextLoad: Function): unknown {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context)
  const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' })
  return { format: 'module', source, shortCircuit: true }
}
