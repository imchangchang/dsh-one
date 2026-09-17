<p align="center">
  <img src="assets/hero.png" alt="DSH One — dsh inside VSCode" width="100%">
</p>

<h1 align="center">DSH One</h1>

<p align="center">The <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a> (dsh) bridge for VSCode: dsh is installed by you, DSH One locates and starts it, embeds the dsh UI in your editor, and turns VSCode into dsh's launcher and display.</p>

<p align="center">
  <a href="https://github.com/imchangchang/dsh-one/actions/workflows/ci.yml"><img src="https://github.com/imchangchang/dsh-one/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT license"></a>
  <a href="#compatibility"><img src="https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-2563EB" alt="Windows / macOS / Linux"></a>
  <a href="#compatibility"><img src="https://img.shields.io/badge/vscode-%5E1.96.0-2563EB" alt="VS Code ^1.96.0"></a>
  <a href="https://github.com/imchangchang/dsh-one/issues?q=label%3Aupstream-watch"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fimchangchang%2Fdsh-one%2Fmain%2F.github%2Fdsh-compat%2Fupstream-latest.json" alt="dsh upstream latest"></a>
  <a href="https://github.com/imchangchang/dsh-one/issues?q=label%3Aupstream-watch"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fimchangchang%2Fdsh-one%2Fmain%2F.github%2Fdsh-compat%2Fcompat.json" alt="dsh-one compatibility"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

> Unofficial community project, not affiliated with DeepSeek. "dsh" belongs to its original project.

---

## What it does

- **dsh UI inside VSCode** — dsh web runs as a local service; DSH One assembles the official dsh web chat UI into a VS Code panel and provides a native sidebar with the sessions list.
- **Start or reuse** — the extension probes the configured port and adopts an already-running dsh instance (connect only, never kill); otherwise it spawns its own `dsh web`. No downloads, no runtime management, no update checks — upgrade dsh yourself with `npm update -g`.
- **Workspace sync** — your current folder is registered as the dsh workspace (idempotent), so dsh opens right where you are working.
- **Native sessions list** — grouped by workspace (current folder on top), with search (title / session id), sorting (recent / oldest / title), pin, mark-as-unread, rename, archive, fork, and "open folder" actions. Hover a session row for the `⋯` menu; refresh follows the dsh host event stream automatically.
- **Assembled chat area** — the conversation area is the official dsh web UI (same components as the browser page), assembled inside VS Code behind a local loopback proxy that handles login and filters out the official frame/sidebar plugins. Clicking the DSH One activity-bar icon opens the sidebar and the chat area together; clicking a session in the sidebar focuses the chat area.

## Screenshots

> The images below show host chrome (sidebar, status bar, install guidance); the chat-area screenshots are being refreshed after the move to the assembled chat area.

| First-run guidance when dsh is missing | Sessions sidebar |
| --- | --- |
| ![](docs/screenshot/en/install-guide.jpeg) | ![](docs/screenshot/zh-CN/session-context-menu.jpeg) |

<img src="docs/screenshot/en/service-starting.jpeg" alt="DSH One status bar while the service is starting" width="100%">

## Quick start

Install DSH One from the VS Code Marketplace and click the DSH One activity-bar icon. On first use the extension locates dsh and starts the service automatically. The service listens on `127.0.0.1` only.

If dsh is not installed yet, the sidebar shows a one-click install command (a community script maintained by dsh-one, shown in the screenshot above): pick your platform, copy, run. The script reuses a compatible Node (≥ 22.19 or ≥ 24) or downloads an official portable Node — no admin rights needed — then installs the official `@deepseek-ai/dsh` package. Matching uninstall scripts live in [`install/`](install/).

Prefer to set it up yourself? Install dsh manually instead (needs Node ≥ 22):

```bash
npm install -g @deepseek-ai/dsh@next
```

## How it works

```mermaid
flowchart LR
  VS["VSCode window"] -->|"activates"| EXT["DSH One extension"]
  EXT -->|"1. locate dsh"| DSH["dsh executable<br/>(dshOne.dshPath or PATH)"]
  DSH -->|"2. probe port (default 3080)"| PROBE{"dsh already<br/>listening?"}
  PROBE -->|"yes — adopt, never kill"| SRV["dsh web service<br/>127.0.0.1:&lt;port&gt;"]
  PROBE -->|"no — spawn"| SPAWN["dsh web --host 127.0.0.1 --port &lt;port&gt;"]
  SPAWN -->|"verify"| SRV
  SRV -->|"3. display"| UI["assembled chat panel +<br/>native sessions sidebar"]
  SRV -->|"4. register current folder<br/>as dsh workspace"| WS["dsh workspace"]
```

1. **Locate** — the `dshOne.dshPath` setting wins; otherwise `dsh` is looked up on PATH.
2. **Start or reuse** — the configured port is checked to see whether a real dsh instance is already running: if so, it is **adopted and reused, never killed**; otherwise the extension starts its own `dsh web`.
3. **Display** — the official dsh web chat UI is assembled into a VS Code panel behind a local loopback proxy (login cookie handling + official frame/sidebar plugins filtered out), while the sidebar offers the native sessions list fed by the dsh event streams.
4. **Workspace preset** — your current folder is registered as the dsh workspace, so dsh opens right where you are working.

## Using DSH One

- **Sidebar (default)** — click the DSH One activity-bar icon: the sidebar opens with the sessions list, and the assembled chat area opens next to it (once per window; if you close it, it stays closed). Pick a session in the sidebar to focus the chat area on it, or start a new one from the `+` menu.
- **Assembled chat** — `DSH One: Open Assembled Chat` opens the chat area explicitly (this is the same command the default-open path uses).
- **Common commands** (`Ctrl/Cmd+Shift+P`):

  | Command | Description |
  | --- | --- |
  | `DSH One: Open Assembled Chat` | Open the assembled chat area |
  | `DSH One: Restart Service` / `DSH One: Stop Service` | Restart / stop the dsh service |
  | `DSH One: Show Status Panel` | Open the status-bar action panel (same as clicking the status-bar item) |
  | `DSH One: Show Logs` | Show the extension log |
  | `DSH One: Copy Local Access Link` / `DSH One: Copy LAN Access Link` | Copy the tokenized dsh web link (the LAN link requires LAN access to be on) |
  | `DSH One: Restart dsh for LAN Access` / `DSH One: Restart dsh for Local-only Access` | Toggle LAN reachability (takes effect with the restart) |
  | `DSH One: Check for dsh Updates` | Compare against the npm `latest` tag; offers Upgrade when a newer version exists |
  | `DSH One: Upgrade dsh` | Run the global install command in the integrated terminal; restart the dsh service afterwards |
  | `DSH One: View dsh Installation Guide` | Open the install guide tab (platform one-liner script + copy, plus a link to the official docs) |

- **Status bar** — shows the service state. **Click** it to open the action panel, which lists the actions available in the current state (open in browser, check for updates or upgrade, copy access link, restart/stop, show logs, …) one action per row; **hover** shows the same set of actions as one link per row. The hover also states whether LAN access is currently on, with a one-click restart to enable it when it is off.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `dshOne.dshPath` | `string` | `""` | Path to the dsh executable; empty means look up `dsh` on PATH |
| `dshOne.port` | `number` | `3080` | Service port; `0` lets the OS assign one (adoption probe is skipped) |
| `dshOne.autoStart` | `boolean` | `true` | Start (or reuse) the dsh web service when the extension activates |
| `dshOne.lanAccess` | `boolean` | `false` | Expose the dsh web service to your local network (dsh itself still listens on 127.0.0.1; DSH One forwards from your LAN address). Anyone on the network with the tokenized link can use dsh |

## Security and permissions

- **Local only by default** — dsh always listens on `127.0.0.1`. With LAN access enabled (`dshOne.lanAccess`, or the one-click restart from the status bar), DSH One forwards from your LAN address to the local service — **anyone on the same network with the tokenized link can use dsh** (it can run commands on your machine). Only enable it on trusted networks and switch back to local-only from the status bar when done.
- **Your data stays with dsh** — DSH One does not read or write `~/.dsh`; that data belongs to dsh. Uninstalling the extension never touches your sessions or workspaces.
- **No runtime management** — the extension does not download or manage Node.js / dsh installs; “Check for Updates / Upgrade” only runs npm's global install command in a visible terminal that you can interrupt.
- **Process safety** — the extension only stops dsh processes it started itself; an already-running dsh instance is reused, never killed. Closing or reloading the VSCode window does not stop dsh.

## Compatibility

- **VS Code**: `^1.96.0`.
- **dsh**: installed by you via npm (`@deepseek-ai/dsh@next`, Node ≥ 22).
- **Platforms**: Windows / macOS / Linux.

### dsh version tracking

A scheduled GitHub Action ([dsh-upstream-watch](.github/workflows/dsh-upstream-watch.yml)) checks for new [dsh releases](https://github.com/deepseek-ai/deepseek-harness/releases) daily; for each new version it runs the automated probe suite (22 checks: the wire protocol, the front-end artifacts the gateway serves — boot contract, combo endpoint, Origin fence —, the client contract surface the assembled UI depends on, and the internal identifiers inside the installed official packages) and files an `upstream-watch` issue with the results. The last two badges above show the latest upstream release and the latest probe outcome; the full test list (automated + manual items) lives in [docs/dsh-compat-checklist.md](docs/dsh-compat-checklist.md).

**Tested versions.** Three dsh versions have been verified end to end:

| dsh version | Status |
|---|---|
| `0.1.2-rc.1` | tested — the baseline every verification lane was built against |
| `0.1.6-alpha.1` | tested — three drifts were found and fixed here: the `details` slot was renamed to `rightbar`, new root-level hooks appeared, and the composer's `imageIds` / `addImages` were renamed to `attachmentIds` / `addAttachments` |
| `0.1.6-alpha.2` | tested — four drifts were found and fixed here (none of them visible to the probes, which only read bytes): the client started adopting the plugin roster the gateway pushes over `/plugins/events`, which reinstated the plugins we block and removed our own (the whole page rendered blank); the session list stopped carrying `current`, which left the sidebar tree with workspaces but no sessions (and the git card without a working directory); the session service dropped `open` / `select` / `clear`, which made clicking a session do nothing; and the `completed` flag moved off the session row into the `sessionStatus` hook, which lost the “finished, not opened yet” dot |
| any other version in `[0.1.2-rc.1, 0.2.0)` | **not tested** — see the gate note below |

**Version gate.** The assembled chat expects dsh `[0.1.2-rc.1, 0.2.0)`: older builds lack the browser-session auth and loader protocol the assembly uses, newer ones are unverified. The gate never blocks — a version outside the range gets an info banner at the top of the panel. Because it is a whole-range check, a 0.1.6 release passes silently even though drift inside the range is proven (the rows above).

**On every upstream release, run three checks** (prerequisites and details in the checklist):

| Check | Command | Covers |
|---|---|---|
| upstream probe | `node scripts/dsh-upstream-watch/probe.mjs --command dsh --expect-version <version>` | wire surface + client contract surface + installed official artifacts: are the slot names, root-level hooks, field/method names and internal identifiers we depend on still there |
| browser verification on the candidate | `npm run verify:lab-version <version>` | does the assembly build up at all **on that version**: four trees boot with no crashed slot and no missing contract. Installs the candidate into a temp dir and runs the lab against it, leaving your installed dsh untouched. This is the gate 0.1.6-alpha.2's blank page walked past — probes read bytes and cannot see it |
| browser verification on your install | `npm run verify:lab` | the same assertions against the dsh on your `PATH`; run it after every change to the assembly |
| host-half verification | `npm run verify:host-half` | the gateway-side plugin half against official dsh |

Who finds what: the probe runs daily in CI and catches renamed slots, hooks and fields before users hit them; the browser lab is the first check for any change to the assembly; VS Code verification (`scripts/dev-ui-test.sh`) is the final authority for host-layer behavior (CSP, clipboard, native menus, webview lifecycle).

| Item | Coverage |
|---|---|
| Startup & auth (ready line, `?token=` cookie exchange, 401 fingerprint) | probe |
| Unary RPC (`session/*`, `workspace/*`, `agentPresets/*`, `commands/*` args shapes) | probe |
| WebSocket streams (`session/follow` snapshot, `session/control` baseline) | probe |
| Client contract surface (slot names, root hooks, field names the assembly depends on) | probe |
| Internal identifiers inside the installed official packages (silent-failure dependencies) | probe |
| Assembled trees on a real gateway (boot, slots filled, no crashed entry) | browser verification — also on the **candidate** version via `verify:lab-version` |
| Host-half plugin against official dsh | `verify:host-half` |
| Live-streaming rendering, approvals/questions through the assembled chat | manual (per-version issue) |
| Session-format migration & rollback, sandbox container regression | manual (per-version issue) |

### Known limitations

- **Windows: subagent / background commands may pop a console window** — when dsh runs without a console (the extension's startup path), Windows gives every child process dsh spawns (bash, pwsh, taskkill, …) its own visible console window. This is an upstream dsh bug ([#1564](https://github.com/deepseek-ai/deepseek-harness/discussions/1564); root causes [#1344](https://github.com/deepseek-ai/deepseek-harness/discussions/1344) and [#1102](https://github.com/deepseek-ai/deepseek-harness/discussions/1102)): a verified patch is proposed upstream but not shipped yet — wait for a dsh release and re-check afterwards.
- **Remote (SSH/WSL/containers) not verified** — the extension supports running on the remote side, but this is untested.
- **Multiple windows** — each VSCode window manages its own service; a busy port is shared, while `port: 0` starts a separate instance per window (session restore may break — prefer a fixed port).

## Uninstall

Uninstall the extension from the VS Code extensions view. dsh itself is installed by you and is not touched; the extension stops only the dsh process it spawned (an adopted instance keeps running), and dsh data (workspaces, sessions) stays in place.

## Development

Build from source with `npm install && npm run build`. `dist/` and `packages/*/lib/` are build outputs and are not in the repository, so build once before running anything that consumes them (`npm test` and the `verify:*` scripts run the build first themselves). The full guide — npm scripts, debugging, the verification lanes — is in [docs/development.md](docs/development.md).

---

## License

MIT © dsh-one contributors
