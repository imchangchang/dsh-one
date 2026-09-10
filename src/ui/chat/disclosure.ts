/**
 * 消息流的「展开态帧」：一个会话一套展开/折叠状态，换会话时整帧换出/换入
 * ——而不是清空（#52 W3：切走再切回，原先全部折叠回去）。
 *
 * 帧里收的容器都是**跨重建持久化**的键值对，键是消息 id / block 位置 / 滚动锚
 * （跨 `loadEarlier` 补页稳定，跨会话无意义，所以按会话隔离而不是共用一张表）：
 * - `detailsOpen`：<details> 家族（思考、代码块、注入上下文、压缩摘要等）；
 * - `toolOpen` / `outputOpen`：工具卡展开、输出「共 N 行」与 diff 行折叠；
 * - `jsonOpenPaths`：JSON 树节点展开集；
 * - `producedOpen`：产物行「+N 个文件」；
 * - `workflowDisclosure`：workflow 运行卡片折叠；
 * - `innerScrollPositions`：卡内滚动容器的位置。
 *
 * 实现要点：**活跃帧的容器对象身份恒定**——`detailsOpen` 在模块初始化时就被
 * markdown 工具链捕获（见 webview.ts 的 mdTools），换帧只能原地改内容
 * （clear + set），不能换对象引用。故 live 是一份固定对象，`activateSession`
 * 把它的各容器存进会话帧、再从目标帧灌回。
 *
 * 瞬时状态（复制反馈、流式签名缓存）不进帧：它们跨会话没有意义，换会话丢掉。
 */
import type { WorkflowDisclosureState } from '../../pure/workflowRun.ts'

/** 一套展开态容器；对象身份在 live 帧上恒定（原地增删，不整体替换）。 */
export interface DisclosureFrame {
  detailsOpen: Map<string, boolean>
  toolOpen: Map<string, boolean>
  outputOpen: Map<string, boolean>
  jsonOpenPaths: Map<string, Set<string>>
  producedOpen: Set<string>
  workflowDisclosure: Map<string, WorkflowDisclosureState>
  innerScrollPositions: Map<string, number>
}

function createFrame(): DisclosureFrame {
  return {
    detailsOpen: new Map(),
    toolOpen: new Map(),
    outputOpen: new Map(),
    jsonOpenPaths: new Map(),
    producedOpen: new Set(),
    workflowDisclosure: new Map(),
    innerScrollPositions: new Map(),
  }
}

const live = createFrame()
/** 尚无会话（hero/空态）时的帧槽位。 */
const NO_SESSION = '\u0000none'
const frames = new Map<string, DisclosureFrame>()
let liveKey: string = NO_SESSION

/** 当前会话的展开态帧（容器对象恒定，可长期持有引用）。 */
export function disclosureFrame(): DisclosureFrame {
  return live
}

/** 把 live 的内容存成一份会话帧（浅拷贝容器：值是布尔/数字/Set，无需深拷）。 */
function snapshotFrame(): DisclosureFrame {
  const frame = createFrame()
  frame.detailsOpen = new Map(live.detailsOpen)
  frame.toolOpen = new Map(live.toolOpen)
  frame.outputOpen = new Map(live.outputOpen)
  frame.jsonOpenPaths = new Map(live.jsonOpenPaths)
  frame.producedOpen = new Set(live.producedOpen)
  frame.workflowDisclosure = new Map(live.workflowDisclosure)
  frame.innerScrollPositions = new Map(live.innerScrollPositions)
  return frame
}

/** 把会话帧灌回 live（原地改容器内容，保持引用不变）。 */
function loadFrom(source: DisclosureFrame | undefined): void {
  const restore = <V>(map: Map<string, V>, saved: Map<string, V> | undefined): void => {
    map.clear()
    if (saved) for (const [key, value] of saved) map.set(key, value)
  }
  const restoreSet = (set: Set<string>, saved: Set<string> | undefined): void => {
    set.clear()
    if (saved) for (const key of saved) set.add(key)
  }
  restore(live.detailsOpen, source?.detailsOpen)
  restore(live.toolOpen, source?.toolOpen)
  restore(live.outputOpen, source?.outputOpen)
  restore(live.jsonOpenPaths, source?.jsonOpenPaths)
  restoreSet(live.producedOpen, source?.producedOpen)
  restore(live.workflowDisclosure, source?.workflowDisclosure)
  restore(live.innerScrollPositions, source?.innerScrollPositions)
}

/**
 * 切到某个会话的帧（同会话重复调用是 no-op）。旧会话的展开态留在自己的帧里，
 * 切回来时原样恢复。
 */
export function activateSession(sessionId: string | null): void {
  const key = sessionId ?? NO_SESSION
  if (key === liveKey) return
  frames.set(liveKey, snapshotFrame())
  liveKey = key
  loadFrom(frames.get(key))
}
