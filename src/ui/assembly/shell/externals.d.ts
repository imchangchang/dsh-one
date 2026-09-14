/**
 * shell 插件的外部依赖类型声明：react / @deepseek-ai/dsh-client-store 在运行
 * 时由主 bundle 的 PLATFORM_MODULES 种子表满足（#63 调研：8 词种子表，私有包
 * 不打进 bundle），构建时 esbuild external 不解析实体包——这里给 tsc 一份
 * 最小环境声明即可。注意保持「最小面」：只声明本插件用到的 API。
 */

declare module 'react' {
  export type ReactNode = unknown
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useLayoutEffect(effect: () => (() => void) | void, deps?: readonly unknown[]): void
  export function useRef<T>(initial: T): { current: T }
  export const Fragment: unique symbol
}

declare module '@deepseek-ai/dsh-client-store' {
  /**
   * 官方 store 形态（ui-layout stores.js）：{ init, actions }，actions 的
   * 第一个参数是可变 draft。框架（renderer standardKit）按 entry 实例化并
   * 注入 useStore / actions 两个座位。
   */
  export function defineStore<S>(spec: {
    init: () => S
    actions: Record<string, (draft: S, ...args: any[]) => void>
  }): unknown
}
