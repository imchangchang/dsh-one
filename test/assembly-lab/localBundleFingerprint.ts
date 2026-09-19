/**
 * 本地插件产物（`dist/assembly/plugins`）的指纹（#207）：整轮验证期间那个目录**有没有被
 * 重写过**。
 *
 * 为什么要有它：#203 把「长轮次里侧栏会话行整片消失（那一刻 `sessionController` 不可用）」
 * 登记成已知噪音——独占、3 条并发、内存 1% 三种现场都没复现，留下的**唯一还没排除的成因
 * 方向**就是这一条：整轮跑到一半时 `dist/assembly/plugins` 被重建。理由有两半——
 * ① 实验室伺服的整包与缓存键都取自那个目录（combo 的 `rev` 拼着本地产物的内容版本，见
 * #173），重建会让中途打开/重载的页面拿到「另一份产物」；
 * ② **`dev-merge` 每次合入都会重建它**（`build.mjs` 开头就是 `rm -rf dist/assembly`，
 * 重建那一段文件根本不在），而 #203 的并发实验跑的是 `node verify.ts`（不重建）——这正是
 * 它与 `npm run verify:lab` 之间唯一的行为差。
 *
 * 两个读数（都只读文件系统，不碰网关、不写任何东西）：
 *
 * - **内容指纹** = `localBundleRev()`：这就是 combo 缓存键里我们自己那一半（#173 用的同一个
 *   函数，不是另写一份），把每个文件的相对路径与内容喂进 SHA-256——改一个字节就变。
 *   整轮开始与整轮结束各算一次。
 * - **轻量指纹** = 只看每个文件的**相对路径 / 大小 / 修改时间**，不读内容，代价可以忽略，
 *   所以**每个套件边界**都算一次。它的用处是**定位**：内容指纹只有首尾两端有，知道「变了」
 *   却不知道「哪一项之后变的」；边界上一串轻量指纹能直接指出那一步。
 *
 * 什么算「变过」：内容指纹变了（产物字节真的换了）**或**轻量指纹变了（目录被重新落盘过，
 * 哪怕最后字节一模一样——重建期间那几个文件有一小段是不在的），两种都记、报告里的措辞
 * 分开写。判据的口径由 {@link describeBundleRound} 定，消费方见 `verify.ts`。
 */
import * as crypto from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Dirent } from 'node:fs'
import { localBundleRev } from '../../src/server/localBundleRev.ts'

/** 目录里一个文件的元信息（轻量指纹与「目录里有什么」都用它）。 */
export interface BundleFile {
  /** 相对被观测目录的路径（`@dsh-one/vscode-chat-ui-layout/client.js` 这样）。 */
  rel: string
  size: number
  mtimeMs: number
}

/** 一次轻量读数（只看元信息，不读内容）。 */
export interface BundleStamp {
  /** 轻量指纹：把每项的「相对路径 + 大小 + 修改时间」喂进 SHA-256，取前 12 位。 */
  stamp: string
  /** 目录里有多少个文件、合计多少字节（人看的）。 */
  files: number
  bytes: number
  /** 目录读不到时的实情（空串 = 读到了）。 */
  detail: string
}

/** 一个采样点（整轮开始、每个套件边界、整轮结束各一个）。 */
export interface BundleSample extends BundleStamp {
  /** 这一步是什么（`整轮开始前` / 套件 id `F-12` / `整轮结束后`）。 */
  at: string
  /** 相对整轮开始的秒数。 */
  seconds: number
}

/** 整轮的四个读数（起止两次内容指纹 + 一串边界轻量采样）。 */
export interface BundleRound {
  /** 被观测的目录（`dist/assembly/plugins`）。 */
  dir: string
  start: BundleSample
  boundaries: readonly BundleSample[]
  end: BundleSample
  /** 整轮开始时的**内容**指纹（= combo 缓存键里本地那一半）。 */
  startContent: string
  /** 整轮结束时的**内容**指纹。 */
  endContent: string
}

/** 目录下每个文件的元信息（每层按名字排序，顺序稳定）。 */
export async function listBundleFiles(dir: string): Promise<BundleFile[]> {
  const out: BundleFile[] = []
  const walk = async (rel: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      const stat = await fsp.stat(path.join(dir, child)).catch(() => null)
      if (stat === null) continue
      out.push({ rel: child, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  await walk('')
  return out
}

/**
 * 轻量指纹（纯函数，单测直接喂文件清单）：把「路径 + 大小 + 修改时间」排序后哈希，
 * 所以顺序与在目录里的落盘顺序不影响结果。修改时间取毫秒浮点——重写一次就会变。
 */
export function bundleStampOf(files: readonly BundleFile[]): string {
  const hash = crypto.createHash('sha256')
  for (const file of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    hash.update(`${file.rel}\0${String(file.size)}\0${String(file.mtimeMs)}\n`)
  }
  return hash.digest('hex').slice(0, 12)
}

/** 一次轻量读数（`listBundleFiles` + `bundleStampOf`，不读文件内容）。 */
export async function readBundleStamp(dir: string): Promise<BundleStamp> {
  const exists = await fsp.stat(dir).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
  if (!exists) return { stamp: '(目录不存在)', files: 0, bytes: 0, detail: `${dir} 不存在（还没跑 npm run build？）` }
  const files = await listBundleFiles(dir)
  if (files.length === 0) return { stamp: '(目录为空)', files: 0, bytes: 0, detail: `${dir} 是空目录` }
  return { stamp: bundleStampOf(files), files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), detail: '' }
}

/**
 * 内容指纹 = combo 整包缓存键里我们自己那一半（#173 的 `localBundleRev`，同一个函数）。
 * 整轮起止各算一次：它读目录里每个文件的全部内容，两遍的开销在一轮十几分钟里可以忽略。
 */
export async function readBundleContentRev(dir: string): Promise<string> {
  return await localBundleRev(dir)
}

/** 字节数给人看（整包几十万个字节，写成 KB 更好读）。 */
function humanBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} 字节` : `${(bytes / 1024).toFixed(1)} KB`
}

/** 一个采样点怎么写进报告（`<at>（<files> 个文件、<bytes>）`）。 */
function describeSample(sample: BundleSample): string {
  return `${sample.at}（${String(sample.files)} 个文件、${humanBytes(sample.bytes)}）`
}

/** 一次指纹变化（第一次看见它的是哪个采样点，以及前后两个轻量指纹）。 */
interface StampChange {
  /** 变化是在哪一步看见的（`进入 F-12 之前` / `整轮结束后`）。 */
  where: string
  /** 第几个套件边界（0 = 整轮结束后那一次）。 */
  boundary: number
  seconds: number
  from: string
  to: string
}

/**
 * 轻量指纹的变化点，按时间顺序（第一个是「第一次看见变化」那一步）。
 *
 * 采样顺序是「整轮开始 → 每个套件边界 → 整轮结束」，逐个和上一条比：套件边界那一批的
 * 前后差就说明那次重建落在**上一个套件跑的那段时间里**。边界采样点写在**进套件之前**，
 * 所以措辞是「进入 <id> 之前」而不是「<id> 跑完之后」——报告里读到的是采样点，不是推断。
 */
function stampChanges(round: BundleRound): StampChange[] {
  const sequence: { sample: BundleSample; where: string; boundary: number }[] = [
    { sample: round.start, where: round.start.at, boundary: -1 },
    ...round.boundaries.map((sample, index) => ({ sample, where: `进入 ${sample.at} 之前`, boundary: index + 1 })),
    { sample: round.end, where: round.end.at, boundary: 0 },
  ]
  const changes: StampChange[] = []
  for (let index = 1; index < sequence.length; index += 1) {
    const previous = sequence[index - 1] as { sample: BundleSample; where: string; boundary: number }
    const current = sequence[index] as { sample: BundleSample; where: string; boundary: number }
    if (previous.sample.stamp === current.sample.stamp) continue
    changes.push({
      where: current.where,
      boundary: current.boundary,
      seconds: current.sample.seconds,
      from: previous.sample.stamp,
      to: current.sample.stamp,
    })
  }
  return changes
}

/**
 * 报告里的那几条事实行（**纯函数**：喂一串采样就出结论，单测覆盖三种形态）。
 *
 * 三种形态的措辞是分开的，因为它们对页面的意义不同：
 * - 内容指纹变了 → 产物字节真的换了一份，**combo 缓存键跟着变**（#173 的那一半），
 *   中途重载的页面会去取另一份整包——这一档就是 #207 要钉的那个成因方向。
 * - 只有轻量指纹变了 → 目录被重新落盘过但字节一样；cache 键不变，可**重建那一小段
 *   文件是不在的**（`rm -rf dist/assembly`），那一瞬开页的读数同样值得怀疑。
 * - 都没变 → 如实记一句「这一轮没有人在中途重建产物」，把这条成因方向当场排除。
 *
 * `changed` 是消费方（`verify.ts`）决定「默认跑法要不要把这几行写进报告」的依据：没变时
 * 默认跑法一个字都不记（报告与改前逐字相同），变了才记——这是「加法」的落点。
 */
export function describeBundleRound(round: BundleRound): { changed: boolean; lines: string[] } {
  if (round.start.detail !== '' || round.end.detail !== '') {
    const startBad = round.start.detail !== ''
    const endBad = round.end.detail !== ''
    return {
      // 一端读得到、另一端读不到，本身就是一次变化（例如整轮跑完时产物目录已经被清掉）。
      changed: startBad !== endBad,
      lines: [
        `本地插件产物（${round.dir}）这一轮有一个端点读不到：整轮开始 ${
          startBad ? round.start.detail : `读到了（${String(round.start.files)} 个文件、内容指纹 ${round.startContent}）`
        }；整轮结束 ${
          endBad ? round.end.detail : `读到了（${String(round.end.files)} 个文件、内容指纹 ${round.endContent}）`
        }`,
      ],
    }
  }
  const changes = stampChanges(round)
  const contentChanged = round.startContent !== round.endContent
  const lines: string[] = []
  if (!contentChanged && changes.length === 0) {
    lines.push(
      `本地插件产物（${round.dir}）整轮没有被重建过：内容指纹一字未变（${round.startContent}，${String(round.start.files)} 个文件、${humanBytes(round.start.bytes)}），` +
        `${String(round.boundaries.length)} 个套件边界上的轻量指纹也没变过`,
    )
    return { changed: false, lines }
  }
  const first = changes[0]
  const where =
    first === undefined
      ? '（轻量指纹没变，只有内容指纹变了——重建把文件落回同一份元信息）'
      : `第一次看见变化是在「${first.where}」这一步（第 ${String(first.boundary)} 个套件边界，第 ${first.seconds.toFixed(0)} 秒；轻量指纹 ${first.from} → ${first.to}）`
  if (contentChanged) {
    lines.push(
      `本轮期间本地插件产物被重建过：内容指纹 ${round.startContent} → ${round.endContent}` +
        `（这个指纹就是 combo 整包缓存键里本地那一半，见 #173）`,
    )
  } else {
    lines.push(
      `本轮期间本地插件产物被重新落盘过，但内容指纹一字未变（${round.startContent}）——产物字节与 combo 缓存键都没变；` +
        `重建那一段文件是不在的（build.mjs 开头是 rm -rf dist/assembly），期间开页的页面可能取不到整包`,
    )
  }
  lines.push(`${where}；对照：整轮开始 ${describeSample(round.start)}，整轮结束 ${describeSample(round.end)}`)
  if (changes.length > 1) {
    const rest = changes.slice(1).map((change) => `${change.where}（${change.seconds.toFixed(0)}s）`)
    lines.push(`轻量指纹整轮一共变过 ${String(changes.length)} 次，其余几次在：${rest.join('、')}`)
  }
  return { changed: true, lines }
}
