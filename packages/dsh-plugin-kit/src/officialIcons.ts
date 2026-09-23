/**
 * 官方图标件的取用口（#236）——插件侧的唯一入口。
 *
 * 名字表与解析规则住在 `src/pure/officialIcons.ts`（单一事实源，探针 import 同一份）；
 * 这个文件只做一件这棵树才能做的事：**把官方模块的命名空间导进来**（源码在仓库里是
 * 外部的，只有各插件自己的 bundle 能在运行时 require 到它，见 `build.mjs` 的 externals
 * 与包清单的 `dsh.client.external`）。
 *
 * 用法（在各插件模块顶层，按自己用到的那几枚逐个取）：
 *
 * ```ts
 * import { officialIcon } from '@dsh-one/dsh-plugin-kit/officialIcons'
 *
 * const IconTrashOutline = officialIcon('IconTrashOutline')
 * ```
 *
 * 为什么是「按枚取」而不是这里一次性导出 26 个常量：一次性导出会让「只用到一枚图标的插件」
 * 在模块加载时把 26 枚全解析一遍，于是**别人那枚**名字消失也会把这个插件带崩。按枚取把失败
 * 面收在该插件自己用到的那几枚上（`src/pure/officialIcons.ts` 的文件头解释了为什么失败要响）。
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 是**命名空间导入**：官方模块由页面主 bundle 的种子表
 * 提供，导出对象是可读的，命名空间导入 + 运行时取属性才能「两代名字都试一遍」。写成具名导入
 * （`import { IconTrashOutline16 }`）就回到「取不到静默变 `undefined`」的老路上了。
 */
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  resolveOfficialIcon,
  type OfficialIconComponent,
  type OfficialIconName,
  type OfficialIconNamespace,
} from '../../../src/pure/officialIcons.ts'

/**
 * 官方模块的命名空间。断言成宽泛的记录类型：官方每加一枚图标都会改模块的形状，
 * 这里只按下标取，不该跟着变（`resolveOfficialIcon` 的第二个参数才是受约束的那一个）。
 */
const NAMESPACE = Primitives as unknown as OfficialIconNamespace

/** 取一枚官方图标件（同一个 bundle 里重复取同一枚只解析一次）。 */
const cache = new Map<OfficialIconName, OfficialIconComponent>()

export function officialIcon(name: OfficialIconName): OfficialIconComponent {
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  const component = resolveOfficialIcon(NAMESPACE, name)
  cache.set(name, component)
  return component
}
