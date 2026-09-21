/**
 * 假的 `vscode` 模块（#223 / #224 的宿主侧 harness）。
 *
 * 为什么需要它：`src/ui/assemblyView.ts` 是**宿主侧**代码（面板的创建 / 聚焦 /
 * 替换 / 关闭、共享 mirror 的引用计数、日志），浏览器验证（`test/assembly-lab/`）
 * 验的是装配**页**，看不到这一层；真窗验收只能人做。而这个任务的判据全都落在这一层
 * （「面板关掉之后再点会话必须建出新面板」「连点两次只建一个」「mirror 引用配平」），
 * 所以要有一个能在 node 里跑真实宿主代码的替身——与 `test/install-guide/`、
 * `test/legacy-sidebar/` 同一套做法：`vscodeLoader.mjs` 把裸模块名 `vscode` 指到这里。
 *
 * 替身如实模拟的那几件事（都是判据吃到的）：
 * - **面板生命周期**：`dispose()` 同步发 `onDidDispose`（真宿主也是同步），dispose
 *   之后 `reveal()` / `webview.postMessage()` / `webview.html = …` 一律抛
 *   `Webview is disposed`（用户现场日志里就是这条消息），`createWebviewPanel`
 *   按调用顺序登记在 {@link panels}；
 * - **宿主收摊形状**（{@link StubPanel.__killWebview}）：webview 已经没了、但
 *   `onDidDispose` 还没送到扩展这里——用户报告的现场（面板被宿主带走、引用还留着）
 *   就是这一档；真宿主在窗口重载 / 扩展宿主退出时确实不逐个 dispose 面板；
 * - **消息通道**：`webview.onDidReceiveMessage` 收下的监听器由 {@link StubWebview.__receive}
 *   驱动（测试据此模拟侧栏页发来的 `dshOne.sessionSelected` / `dshOne.hostCall`），
 *   `postMessage` 的出向消息登记在 `webview.sent`；
 * - **用户可见提示**：`showErrorMessage` / `showWarningMessage` 记进
 *   {@link messagesShown}，判「兜底不再静默」用它（#223）。
 *
 * 不模拟的：真渲染、真 webview、真命令实现（`executeCommand` 只调本替身登记过的
 * 命令，其余空转）、`Uri` 只支持到「有 fsPath」为止（`localBundleRev` / `pageHtml`
 * 用得到的程度）。
 */

let nextPanelId = 1

/** 这条 webview 的宿主替身面。 */
export interface StubWebview {
  html: string
  options: Record<string, unknown>
  cspSource: string
  /** 出向消息（宿主 → 页面）。 */
  sent: unknown[]
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  postMessage(message: unknown): Promise<boolean>
  asWebviewUri(uri: unknown): unknown
  /** 测试用：把一条页面 → 宿主的消息送进这条 webview。 */
  __receive(message: unknown): void
}

/** 一个面板的替身（真宿主里是 `vscode.WebviewPanel`）。 */
export interface StubPanel {
  readonly id: number
  readonly viewType: string
  title: string
  iconPath: unknown
  readonly webview: StubWebview
  /** `reveal()` 被调用过几次（「已开则聚焦、不新开」这类判据读它）。 */
  revealed: number
  /** 面板是不是已经没了（dispose 过，或 webview 被宿主收走）。 */
  dead: boolean
  reveal(): void
  dispose(): void
  onDidDispose(listener: () => void): { dispose(): void }
  /**
   * 「宿主收摊」形状：webview 已经没了，但 dispose 事件还没送到扩展这边。
   * 之后对它的 `reveal()` / `postMessage()` / `html=` 都会抛 `Webview is disposed`。
   */
  __killWebview(): void
}

/** 建出来的面板，按创建顺序。 */
export const panels: StubPanel[] = []

/** 弹给用户的提示（`showErrorMessage` / `showWarningMessage` / `showInformationMessage`）。 */
export const messagesShown: { level: 'error' | 'warn' | 'info'; message: string }[] = []

/** 登记过的命令（`commands.registerCommand`）。 */
export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>()

/** 登记过的侧栏 view provider（`window.registerWebviewViewProvider`）。 */
export const viewProviders = new Map<string, unknown>()

/** 登记过的面板恢复器（`window.registerWebviewPanelSerializer`）。 */
export const panelSerializers = new Map<string, unknown>()

/** 让某次 `createWebviewPanel` 直接抛错（判「兜底不再静默」用）。 */
export let failNextPanelCreate = false

export function setFailNextPanelCreate(fail: boolean): void {
  failNextPanelCreate = fail
}

function disposedError(): Error {
  return new Error('Webview is disposed')
}

function createWebview(panel: { dead: boolean }): StubWebview {
  const listeners = new Set<(message: unknown) => void>()
  const sent: unknown[] = []
  let html = ''
  return {
    get html(): string {
      return html
    },
    set html(value: string) {
      if (panel.dead) throw disposedError()
      html = value
    },
    options: {},
    cspSource: 'vscode-webview://stub',
    sent,
    onDidReceiveMessage(listener: (message: unknown) => void) {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
    postMessage(message: unknown): Promise<boolean> {
      if (panel.dead) return Promise.reject(disposedError())
      sent.push(message)
      return Promise.resolve(true)
    },
    asWebviewUri: (uri: unknown) => uri,
    __receive(message: unknown): void {
      for (const listener of [...listeners]) listener(message)
    },
  }
}

function createWebviewPanel(_viewType: string, title: string): StubPanel {
  const panel = { dead: false } as { dead: boolean }
  const disposeListeners = new Set<() => void>()
  const created = {
    id: nextPanelId++,
    viewType: _viewType,
    title,
    iconPath: undefined as unknown,
    webview: createWebview(panel),
    revealed: 0,
    get dead(): boolean {
      return panel.dead
    },
    reveal(): void {
      if (panel.dead) throw disposedError()
      created.revealed += 1
    },
    dispose(): void {
      if (panel.dead) return
      panel.dead = true
      for (const listener of [...disposeListeners]) listener()
    },
    onDidDispose(listener: () => void) {
      disposeListeners.add(listener)
      return { dispose: () => disposeListeners.delete(listener) }
    },
    __killWebview(): void {
      panel.dead = true
    },
  } satisfies StubPanel
  panels.push(created)
  return created
}

/** 造一条独立的假 webview（侧栏 view 用；不是面板）。`kill()` = 宿主把它收走了。 */
export function createStubWebview(): { webview: StubWebview; kill(): void } {
  const state = { dead: false }
  return { webview: createWebview(state), kill: () => (state.dead = true) }
}

const colorThemeListeners = new Set<() => void>()

export const window = {
  activeColorTheme: { kind: 2 },
  createWebviewPanel: (viewType: string, title: string) => {
    if (failNextPanelCreate) {
      failNextPanelCreate = false
      throw new Error('stub: createWebviewPanel failed on purpose')
    }
    return createWebviewPanel(viewType, title)
  },
  onDidChangeActiveColorTheme(listener: () => void) {
    colorThemeListeners.add(listener)
    return { dispose: () => colorThemeListeners.delete(listener) }
  },
  showErrorMessage(message: string) {
    messagesShown.push({ level: 'error', message })
    return Promise.resolve(undefined)
  },
  showWarningMessage(message: string) {
    messagesShown.push({ level: 'warn', message })
    return Promise.resolve(undefined)
  },
  showInformationMessage(message: string) {
    messagesShown.push({ level: 'info', message })
    return Promise.resolve(undefined)
  },
  showInputBox: async () => undefined,
  showSaveDialog: async () => undefined,
  showTextDocument: async () => undefined,
  registerWebviewPanelSerializer(viewType: string, serializer: unknown) {
    panelSerializers.set(viewType, serializer)
    return { dispose: () => panelSerializers.delete(viewType) }
  },
  registerWebviewViewProvider(viewId: string, provider: unknown) {
    viewProviders.set(viewId, provider)
    return { dispose: () => viewProviders.delete(viewId) }
  },
}

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    registeredCommands.set(id, handler)
    return { dispose: () => registeredCommands.delete(id) }
  },
  executeCommand: async (id: string, ...args: unknown[]): Promise<unknown> => {
    const handler = registeredCommands.get(id)
    return handler === undefined ? undefined : await handler(...args)
  },
}

export const workspace = {
  name: undefined as string | undefined,
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({ get: () => undefined }),
  openTextDocument: async () => {
    throw new Error('stub: no such document')
  },
  onDidChangeConfiguration: () => ({ dispose: () => undefined }),
}

export const env = {
  language: 'en',
  clipboard: { writeText: async () => undefined },
  openExternal: async () => true,
}

export const l10n = {
  /** 与真宿主一致：无译文时返回 key 本身；`{0}` 占位按参数替换。 */
  t(key: string, ...args: unknown[]): string {
    return key.replace(/\{(\d+)\}/g, (all, index: string) =>
      args[Number(index)] === undefined ? all : String(args[Number(index)]),
    )
  },
}

export function uriOf(fsPath: string): { fsPath: string; path: string; scheme: string; toString(): string } {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath}`,
  }
}

export const Uri = {
  file: (fsPath: string) => uriOf(fsPath),
  joinPath: (base: { fsPath?: string } | undefined, ...parts: string[]) =>
    uriOf([base?.fsPath ?? '', ...parts].join('/').replace(/\/+/g, '/')),
  parse: (text: string) => uriOf(text.replace(/^file:\/\//, '')),
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>()

  readonly event = (listener: (value: T) => void) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value)
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export const Disposable = {
  from: (...items: { dispose?: () => void }[]) => ({
    dispose: () => {
      for (const item of items) item?.dispose?.()
    },
  }),
}

export const ViewColumn = { Active: -1, One: 1, Two: 2 }

export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 }

export const ExtensionMode = { Production: 1, Development: 2, Test: 3 }

export const version = '1.99.0-stub'

/** 把一条主题变化广播推给登记过的监听器（本轮判据用不到，留着免得别处踩空）。 */
export function __fireColorThemeChange(): void {
  for (const listener of [...colorThemeListeners]) listener()
}
