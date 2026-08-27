# DSH One 开发指南

## 环境要求

- **Node ≥ 22.6**（`npm test` 用 `node --test` 直接跑 `.ts` 文件，依赖 22.6+ 的实验性 type stripping；构建本身 target 是 Node 22）。
- VSCode ≥ 1.96（`engines.vscode`，`@types/vscode` 同步）。
- 系统 `tar`：下载的 Node 发行包靠它解压（Windows 10+ 自带 bsdtar；没有时回退 PowerShell `Expand-Archive`，`src/runtime/node.ts:115-122`）。

```bash
npm install   # 只有 devDependencies：typescript / esbuild / @vscode/vsce / @types/*
```

## npm scripts

| 命令 | 干什么 |
| --- | --- |
| `npm run build` | `node build.mjs`：esbuild 把 `src/extension.ts` 打成单文件 `dist/extension.js`（cjs、target node22、`vscode` external、带 sourcemap）。有 warning 会以非零码退出。 |
| `npm run typecheck` | `tsc --noEmit`。注意 import 都带 `.ts` 后缀（`allowImportingTsExtensions` + `verbatimModuleSyntax`），新增 import 要遵守。 |
| `npm test` | `node --test test/*.test.ts`，只覆盖 `src/pure/`。改 pure 模块必须跑。 |
| `npm run package` | 先 build，再 `vsce package` 打出 `.vsix`（`.vscodeignore` 排除了 src/test/node_modules 等，VSIX 里只有 dist + 清单 + 图标等）。 |

## 调试（F5 Extension Development Host）

仓库带了 `.vscode/launch.json`。流程：

1. `npm run build`（launch 配置没有挂 preLaunchTask，改了代码要自己先 build）。
2. 在 VSCode 里打开本仓库，按 F5，会拉起一个 Extension Development Host 窗口。
3. 在宿主窗口的 `src/` 里下断点即可（有 sourcemap）。dev host 窗口里点活动栏的 DSH One 图标触发首次启动流程；日志在 dev host 的"输出 → DSH One"面板。

注意：dev host 与正式 VSCode 共用同一份用户 globalStorage，所以正式环境下载过的运行时在 dev host 里会被直接复用。

## src/pure/ 为什么不许 import vscode

`src/pure/` 下的模块（envelope / readyLine / registry / semver）用 `node --test` 直接跑单测，而 `node --test` 环境里没有 `vscode` 模块——一旦 import 就整个跑不了。所以约定：**pure 里只能出现 Node 内置模块和纯类型**。反过来，凡是"不碰 vscode API 的判断逻辑"（协议校验、版本选择、正则解析）都应下沉到 pure，换取可测性。现有的四个文件头部注释都写明了这条约定，新增 pure 模块照做。

## 手动模拟"首次无运行时"场景

运行时缓存在扩展的 globalStorage 下（扩展 ID 是 `dsh-one.dsh-one`）：

- macOS：`~/Library/Application Support/Code/User/globalStorage/dsh-one.dsh-one/`
- Windows：`%APPDATA%\Code\User\globalStorage\dsh-one.dsh-one\`
- Linux：`~/.config/Code/User/globalStorage/dsh-one.dsh-one/`

模拟各种场景：

- **首次使用（连 Node 都要下载）**：退出 VSCode，删掉整个 `dsh-one.dsh-one/` 目录，重开。
- **只重装 dsh**：删 `runtimes/dsh/<版本>/` 子目录（保留 `current.json`/`last-good.json` 可顺便验证回退逻辑）。
- **验证 last-good 回退**：把 `current.json` 指到一个不存在的版本号，或把目标版本目录里的 `lib/bin.js` 删掉，`ensureDsh` 自检会失败并回退（`src/runtime/dshRuntime.ts:188-201`）。
- **强制走系统 Node 之外的下载路径**：临时把 PATH 里的 node 摘掉（或在 dev host 里用干净环境）。
- **重置更新检查节流**：12h 节流时间戳在 `globalState`（`dshOne.lastUpdateCheck`），不在磁盘目录里；直接用命令 `DSH One: 检查 dsh 更新`（force，绕过节流）即可，不用清状态。
- **验证复用语义**：先手动 `dsh web --port 3080` 起一个实例，再打开面板，状态栏 tooltip 应显示"已复用已有实例"，关闭 VSCode 后该实例应仍在运行。

## 发版流程

1. **改 publisher**：`package.json` 的 `"publisher": "dsh-one"` 是占位，发布前必须改成你在 marketplace 的 publisher ID。
2. 更新 `package.json` 的 `version` 和 `CHANGELOG.md`。
3. `npm run typecheck && npm test && npm run package`，确认打出 `.vsix`。
4. 登录与发布（PAT 来自 Azure DevOps，scope 要勾 Marketplace > Manage）：
   ```bash
   npx vsce login <publisher>
   npx vsce publish        # 或 npx vsce publish patch/minor 顺带 bump version
   ```

### 发 marketplace 前的人工点验清单

目前没有任何端到端自动化覆盖"真实下载 + 真实 dsh"，发布前必须人工过一遍：

- [ ] 删掉 globalStorage 目录模拟全新用户，F5 或安装 VSIX 后打开面板：Node 下载 → dsh 下载 → 服务启动 → iframe 加载出官方 UI，全链路无报错。
- [ ] `dsh_embed=vscode` 生效：iframe 里官方 UI 的侧栏是隐藏的。
- [ ] 状态栏四态（运行中/启动中/已停止/错误）显示正确，复用已有实例时 tooltip 有提示。
- [ ] 手动起一个 `dsh web --port 3080` 再开面板，确认复用该实例且不 kill。
- [ ] 关闭 VSCode 后确认 spawn 的 dsh 进程被回收（`ps` / 任务管理器），复用的实例不受影响。
- [ ] `DSH One: 重启服务` / `停止服务` / `检查 dsh 更新` / `显示日志` 四个命令各点一次。
- [ ] Windows 和 macOS 至少各过一遍上面的流程（spawn/杀进程路径分平台）。
