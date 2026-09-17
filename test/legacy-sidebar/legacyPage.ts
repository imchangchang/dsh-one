/**
 * 旧侧栏那一页 HTML 的产出与伺服（真宿主代码 + 打桩的 `vscode`）。
 *
 * 页面不是 harness 抄一份模板，而是调 `src/ui/sessionsView.ts` 的
 * `SessionsViewProvider.resolveWebviewView()`——HTML 骨架、`SESSIONS_STYLE`、l10n 注入
 * 与 `dist/sessionsWebview.js` 的引用全部来自仓库里那份代码。harness 只做三件打桩：
 *
 * 1. `vscode` 模块（见 `vscodeStub.mjs`）：`Uri.joinPath` 让译文按真文件读，
 *    `env.language` 决定注入哪一份；
 * 2. `vscode.Webview`：`asWebviewUri` 把 `dist/sessionsWebview.js` 映射到本 harness
 *    服务器上的同一个路径；`onDidReceiveMessage` 收下页面发回的动作消息后**丢掉**；
 * 3. `SessionsStore`：`snapshot()` 返回注入的那份快照，`onDidChange` 给个空订阅。
 *
 * 动作消息**一律不实现**（点了不报错即可）：消息不落网关，也不改任何状态。
 */
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionsSnapshot } from '../../src/pure/chatContract.ts'
import type { SessionsStore } from '../../src/ui/sessionsStore.ts'
import type { ServerManager } from '../../src/server/manager.ts'
import { SessionsViewProvider } from '../../src/ui/sessionsView.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const disposable = (): { dispose: () => void } => ({ dispose: () => undefined })

/** 旧侧栏那一页的真实 HTML。 */
export function buildLegacyPage(snapshot: SessionsSnapshot): string {
  const webview = {
    options: {} as Record<string, unknown>,
    html: '',
    cspSource: 'vscode-webview://legacy-sidebar-lab',
    // 页面里的脚本就一张：`dist/sessionsWebview.js`，映射成本服务器上的同名路径。
    asWebviewUri: () => ({ toString: () => '/dist/sessionsWebview.js' }),
    postMessage: () => Promise.resolve(true),
    // 页面发回的动作消息（打开/新建/重命名/回收站…）：**收下就丢**。
    // 本 harness 只渲染，动作一律不实现——不落网关、不改状态（见文件头）。
    onDidReceiveMessage: (_listener: (message: unknown) => void) => disposable(),
  }

  const view = {
    webview,
    visible: true,
    onDidChangeVisibility: () => disposable(),
    onDidDispose: () => disposable(),
  }

  const store = {
    onDidChange: () => disposable(),
    refreshSoon: () => undefined,
    snapshot: () => snapshot,
  } as unknown as SessionsStore

  const manager = {
    onDidChangeState: () => disposable(),
    getStatus: () => ({ state: 'running' }),
  } as unknown as ServerManager

  const provider = new SessionsViewProvider(
    manager,
    { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    { fsPath: REPO } as never,
    store,
    () => snapshot.activeSessionId ?? null,
    () => snapshot.activeSessionId ?? null,
    () => disposable(),
  )

  provider.resolveWebviewView(view as never)
  return webview.html
}

/** 伺服旧侧栏页面的最小服务器：`/` 给页面，`/dist/sessionsWebview.js` 给真产物。 */
export interface LegacyServer {
  readonly origin: string
  dispose(): Promise<void>
}

export async function startLegacyServer(html: string): Promise<LegacyServer> {
  const script = await fsp.readFile(path.join(REPO, 'dist', 'sessionsWebview.js'))
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (url.pathname === '/dist/sessionsWebview.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(script)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address !== 'object') {
        reject(new Error('legacy-sidebar: no loopback address'))
        return
      }
      resolve(address.port)
    })
  })

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
