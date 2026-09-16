/**
 * 宿主半用到官方包的类型投影（#84）。
 *
 * 与 `src/ui/assembly/shell/externals.d.ts` 同一做法、同一理由：本仓库的
 * node_modules 里没有 `@deepseek-ai/*`（官方包由 dsh 的全局安装提供，`packages/
 * dsh-host-capabilities/package.json` 只在**安装到 profile 时**声明这个依赖），
 * 所以构建/类型检查时给 tsc 一份最小声明。**保持最小面**：只声明宿主半真正用到的
 * 三个导出（`Remote` / `bindTypertRemote` / `RemoteError`），官方包形态变化时这
 * 份声明会先失配、逼着我们去核对，而不是静默漂移。
 *
 * 出处：`@deepseek-ai/dsh-typert-protocol` 0.1.6-alpha.1 的 `lib/types/index.d.ts`
 * （README「Exposing a Host method」是作者视角的同一份说明）。
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  /** 方法装饰器：标记一条要暴露成 Remote 端点的公开实例方法。 */
  export function Remote(
    methodOrOptions: string | { mode: 'stream' },
  ): <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  /** 声明服务实例与线命名空间的绑定（网关 SRC 发现据此认领端点）。 */
  export function bindTypertRemote<Service extends object>(
    service: Service,
    serviceKey: string,
    options?: { namespace?: string },
  ): unknown
}
