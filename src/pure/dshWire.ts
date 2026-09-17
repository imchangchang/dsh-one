/**
 * dsh wire 的版本判定与 `commands/execute` 参数形状——**单一事实源**（#37）。
 *
 * 这份知识此前存在第二份拷贝：上游探针 `scripts/dsh-upstream-watch/probe.mjs`
 * 自己复刻了一遍参数形状，于是协议一漂移（0.1.3 把第三个参数从 `images` 改名
 * `submittedAttachments`）探针就误报，还得人工先发现「是探针过时」。现在运行时
 * （`src/server/dshRpc.ts`）与探针 import 同一个函数：dsh-one 改了，探针自动跟随。
 *
 * 纯逻辑：不 import `vscode`、不碰网络、无副作用。探针是裸 node 脚本，靠 Node 的
 * 类型剥离直接 import 本文件（import 说明符要带 `.ts` 后缀）。
 */
import { parse as parseSemver } from './semver.ts'

/** 待发附件的一个元素（与 `OutgoingImage` 同形；按结构收，不依赖上层类型）。 */
export interface WireAttachment {
  mediaType: string
  data: string
  name?: string
}

/** 0.1.3+ 形状的附件元素：比 0.1.2 多一个 `type: 'image'` 判别键。 */
export interface WireCommandAttachment extends WireAttachment {
  type?: 'image'
}

/** `commands/execute` 的参数对象（两代形状的并集；网关按版本严格校验，只能发一个键）。 */
export type CommandsExecuteArgs =
  | { agentId: string; line: string; images: WireAttachment[] }
  | { agentId: string; line: string; submittedAttachments: WireCommandAttachment[] }

/**
 * true = 该版本走 0.1.3+ 的 wire：`commands/execute` 收 `submittedAttachments`，
 * 流式增量走 `assistantStream`。0.1.1/0.1.2（及其任意 prerelease）一律 false，
 * 按老路径走以确保老版本零改动；版本未知或解析不出来时保守返回 false。
 */
export function is013WireVersion(version: string | undefined): boolean {
  if (version === undefined) return false
  const parsed = parseSemver(version)
  if (parsed === null) return false
  return parsed.major > 0 || parsed.minor > 1 || (parsed.minor === 1 && parsed.patch >= 3)
}

/**
 * `commands/execute` 该发什么形状：0.1.3 起第三个参数是
 * `submittedAttachments: {type:'image', …}[]`，0.1.2 及以前是 `images: {…}[]`。
 * 网关的 `assertExactArguments` 拒绝多余键，**不能两个键都发**——发错了会被
 * `gateway/arguments-invalid` 拒，全部斜杠命令失效。
 */
export function commandsExecuteArgs(
  version: string | undefined,
  sessionId: string,
  line: string,
  attachments: WireAttachment[] = [],
): CommandsExecuteArgs {
  if (is013WireVersion(version)) {
    return {
      agentId: sessionId,
      line,
      submittedAttachments: attachments.map((a) => ({ type: 'image' as const, ...a })),
    }
  }
  return { agentId: sessionId, line, images: attachments }
}
