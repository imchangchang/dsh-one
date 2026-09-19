/** 把裸模块名 `vscode` 解析到 `vscodeStub.mjs`（Node 解析钩子）。 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vscode') {
    return { url: new URL('./vscodeStub.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
