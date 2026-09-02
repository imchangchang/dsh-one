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
- dev host 与正式 VSCode 共用 `~/.dsh` 和默认端口：如果 3080 上已有 dsh 在跑，dev host 会直接**复用**它而不是另起实例。

## src/pure/ 为什么不许 import vscode

`src/pure/` 下的模块（envelope / readyLine / semver / workspace）用 `node --test` 直接跑单测，而 `node --test` 环境里没有 `vscode` 模块——一旦 import 就整个跑不了。所以约定：**pure 里只能出现 Node 内置模块和纯类型**。反过来，凡是"不碰 vscode API 的判断逻辑"（协议校验、正则解析、列表 diff）都应下沉到 pure，换取可测性。现有的文件头部注释都写明了这条约定，新增 pure 模块照做。

## 逻辑 bug：先写失败单测再修

`src/pure/` 里的 bug 修法：先在 `test/` 用 `node --test` 复现成一条**失败**测试，修码期间**不许碰测试文件**，修完让测试转绿。这样 bug 固化进回归，治标也治本。

- 这条**只对 `src/pure/`（可被 `node --test` 覆盖的那层）成立**。
- **UI bug 不适用**：渲染/布局/交互单测测不到，走 `ai-visual-validation`（浏览器渲染 + 截图对照期望）+ 人工 `dev-ui-test` 窗口，见 `worktree-dev-flow` skill 的人工门禁环节。

## 手动模拟异常场景

- **未安装 dsh**：临时把 PATH 里的 dsh 摘掉（或把 `dshOne.dshPath` 指到不存在的路径），打开面板应报"未找到 dsh"并引导安装。
- **验证复用语义**：先手动 `dsh web --port 3080` 起一个实例，再打开面板，状态栏 tooltip 应显示"已复用已有实例"，关闭 VSCode 后该实例应仍在运行。

## 发版流程

发布门禁：`scripts/release-gate.sh`（默认 dry-run 只输出计划与只读校验，`--apply` 才执行）。两段式：

1. `scripts/release-gate.sh`：看计划与当前状态校验（version / CHANGELOG / tag / 工作树）。
2. `scripts/release-gate.sh --apply`：交互输入新版本 → bump `package.json` 的 `version` → 停下。**正式版**同时把 `CHANGELOG.md` 的 `[Unreleased]` 收口成 `[x.y.z]`；**预发布（`x.y.z-rc.N`）不消费 CHANGELOG**（rc 只 bump 版本，测试通过后发同核心正式版才收口）。
3. review 后提交（建议只提交这些文件）：`git commit -m "release: v<x.y.z>"`。
4. `scripts/release-gate.sh --tag`：校验工作树干净 → 打 `git tag v<x.y.z>`（== 收口 commit）。
5. push tag 触发构建：`git push origin main && git push origin v<x.y.z>`。`.github/workflows/release.yml` 会跑 typecheck/test/package、用 `scripts/verify-vsix.sh` 验产物，把 `dsh-one-<版本>.vsix` 挂到 GitHub Release（**rc 版本标 prerelease**）。
6. 按 `docs/release-checklist.md` 人工验收（沙盒装机 + README 确认）。**验收对象 = GitHub Release 的 vsix（从 Releases 页下载），本地不再打包。**
7. 正式版登录与发布（PAT 来自 Azure DevOps，scope 要勾 Marketplace > Manage；release-gate 不跑 publish，这一步由人执行；**rc 不发布市场**）：
   ```bash
   npx vsce login cgeng
   npx vsce publish dsh-one-<x.y.z>.vsix   # 带路径、用 Release 下载的那份，不重新打包
   ```

注意：`package.json` 的 `"publisher"` 应是你发布的 marketplace 账号（现为 `cgeng`），发布前确认即可，无需修改。版本策略：每次发布 +1（正式版 patch+1，rc 按 rc.N 递增；首发 1.0.0），市场不可同版本重发。
