# DSH One 开发指南

## 环境要求

- **Node ≥ 22.6**（`npm test` 用 `node --test` 直接跑 `.ts` 文件，依赖 22.6+ 的实验性 type stripping；构建本身 target 是 Node 22）。
- VSCode ≥ 1.96（`engines.vscode`，`@types/vscode` 同步）。
- **本机已安装 dsh**：`npm i -g @deepseek-ai/dsh@next`。扩展不再自动下载运行时，调试和点验都需要真实 dsh。

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
3. 在宿主窗口的 `src/` 里下断点即可（有 sourcemap）。dev host 激活即自动启动 dsh（`dshOne.autoStart`，默认开）；日志在 dev host 的"输出 → DSH One"面板。

注意：

- 扩展不再自动下载运行时。dev host 里如果 PATH 上没有 dsh，启动会失败并提示安装（`npm i -g @deepseek-ai/dsh@next`）；也可以用 `dshOne.dshPath` 指向任意 dsh 可执行文件。
- dev host 与正式 VSCode 共用 `~/.dsh` 和默认端口：如果 3080 上已有 dsh 在跑，dev host 会直接**收养**它而不是另起实例。

## src/pure/ 为什么不许 import vscode

`src/pure/` 下的模块（envelope / readyLine / semver / workspace）用 `node --test` 直接跑单测，而 `node --test` 环境里没有 `vscode` 模块——一旦 import 就整个跑不了。所以约定：**pure 里只能出现 Node 内置模块和纯类型**。反过来，凡是"不碰 vscode API 的判断逻辑"（协议校验、正则解析、列表 diff）都应下沉到 pure，换取可测性。现有的文件头部注释都写明了这条约定，新增 pure 模块照做。

## 逻辑 bug：先写失败单测再修

`src/pure/` 里的 bug 修法：先在 `test/` 用 `node --test` 复现成一条**失败**测试，修码期间**不许碰测试文件**，修完让测试转绿。这样 bug 固化进回归，治标也治本。

- 这条**只对 `src/pure/`（可被 `node --test` 覆盖的那层）成立**。
- **UI bug 不适用**：渲染/布局/交互单测测不到，走 `ai-visual-validation`（浏览器渲染 + 截图对照期望）+ 人工 `dev-ui-test` 窗口，见 `worktree-dev-flow` skill 的人工门禁环节。

## 手动模拟异常场景

- **未安装 dsh**：临时把 PATH 里的 dsh 摘掉（或把 `dshOne.dshPath` 指到不存在的路径），打开面板应报"未找到 dsh"并引导安装。
- **验证收养语义**：先手动 `dsh web --port 3080` 起一个实例，再打开面板，状态栏 tooltip 应显示"已复用已有实例"，关闭 VSCode 后该实例应仍在运行。

## 发版流程

1. **确认 publisher**：`package.json` 的 `"publisher"` 应是你要发布的 marketplace 账号（现为 `cgeng`），发布前确认即可，无需修改。
2. 更新 `package.json` 的 `version` 和 `CHANGELOG.md`。
3. `npm run typecheck && npm test && npm run package`，确认打出 `.vsix`。
4. 登录与发布（PAT 来自 Azure DevOps，scope 要勾 Marketplace > Manage）：
   ```bash
   npx vsce login <publisher>
   npx vsce publish        # 或 npx vsce publish patch/minor 顺带 bump version
   ```

### 发 marketplace 前的人工点验清单

目前没有任何端到端自动化覆盖真实 dsh，发布前必须人工过一遍：

- [ ] 模拟未安装 dsh 的环境（摘掉 PATH 上的 dsh）：打开面板报错并引导安装，无其他异常。
- [ ] 装好 dsh 后打开面板：定位 → 启动服务 → iframe 加载出官方 UI，全链路无报错。
- [ ] `dsh_embed=vscode` 生效：iframe 里官方 UI 的侧栏是隐藏的。
- [ ] 状态栏四态（运行中/启动中/已停止/错误）显示正确，收养已有实例时 tooltip 有提示。
- [ ] 手动起一个 `dsh web --port 3080` 再开面板，确认收养该实例且不 kill。
- [ ] 关闭 VSCode 后确认 spawn 的 dsh 进程被回收（`ps` / 任务管理器），收养的实例不受影响。
- [ ] `DSH One: 打开面板` / `在编辑器标签页打开` / `重启服务` / `停止服务` / `显示日志` 各点一次。
- [ ] Windows 和 macOS 至少各过一遍上面的流程（spawn/杀进程路径分平台）。
