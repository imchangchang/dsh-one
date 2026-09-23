/**
 * 版本门：装配界面对 dsh 版本的期望区间，以及「越界了该装哪一版」的那条命令。
 *
 * 为什么单独一个纯模块：区间与命令有两处消费方——产品侧 `src/ui/assemblyView.ts`（往
 * 信息条里填文案）与装配实验室 `test/assembly-lab/labServer.ts`（页面按同一条件决定
 * 显不显示信息条）。这两处原来各写一份常量 + 各写一句英文文案，靠注释声明「同一口径」；
 * 常量一改就得两地同改，漏一处就是「实验室不报警、产品报警」这种查起来很闷的偏差
 * （#234 这一次正是要改常量）。所以取值集中在这里，两边都 import。
 *
 * 界面上的展示逻辑（`vscode.l10n.t` 的两句文案）留在产品侧；这里只给取值与判定，
 * 因为 `assemblyView.ts` 依赖 `vscode`，实验室起不来那个模块。
 */
import { compare, parse } from './semver.ts'

/**
 * 下界 = **实测通过的最老版本**（#234）。低于下界的那几代实测有红，读数与红项见
 * `docs/dsh-compat-checklist.md`：0.1.2-rc.1 上「把某条会话变成当前会话」这条主路径
 * 整个不成立（那一代官方产物里没有 `openSession`）；0.1.5-rc.2 上启动自愈不生效、
 * composer 的 ＋ 不在场。
 */
export const PREREQ_MIN = '0.1.6-alpha.1'

/** 上界：更高的版本没验过。 */
export const PREREQ_MAX = '0.2.0'

/**
 * 信息条告诉用户去哪一版：npm 上给出「下界及以上」版本的那个 dist-tag。
 *
 * 为什么要写死一个标签：信息条原来只说「期望 [下界, 上界)」，用户看到区间也不知道该装
 * 哪一版；而 npm 的 `latest` 与 `next` 现在**都低于下界**（2026-09-23 实测 `latest` =
 * 0.1.5-rc.2、`next` = 0.1.5-rc.3），照 README 快速开始那条 `@next` 装下来正好落在区间
 * 外。上游把 `latest` / `next` 挪进区间之后，这个常量应当改回 `latest`。
 */
export const INSTALL_TAG = 'alpha'

/** 区间的一句话写法（信息条里给用户看的那一段）。 */
export function prereqRangeLabel(): string {
  return `${PREREQ_MIN} ≤ version < ${PREREQ_MAX}`
}

/** 装出受支持版本的那条命令（信息条里给用户抄的那一条）。 */
export function installCommand(): string {
  return `npm install -g @deepseek-ai/dsh@${INSTALL_TAG}`
}

/** 该版本是否落在期望区间内（取不到或解析不出 = 不在，由调用方决定怎么提示）。 */
export function inPrereqRange(version: string | undefined): boolean {
  if (version === undefined) return false
  return parse(version) !== null && compare(version, PREREQ_MIN) >= 0 && compare(version, PREREQ_MAX) < 0
}
