# DSH One 开发指南

## 环境要求

- **Node ≥ 22.6**（`npm test` 用 `node --test` 直接跑 `.ts` 文件，依赖 22.6+ 的实验性 type stripping；构建本身 target 是 Node 22）。
- VSCode ≥ 1.96（`engines.vscode`，`@types/vscode` 同步）。
- **本机已安装 dsh**：`npm i -g @deepseek-ai/dsh@next`。扩展不再自动下载运行时，调试和点验都需要真实 dsh。

```bash
npm install   # 只有 devDependencies：typescript / esbuild / @vscode/vsce / @types/*
```

## 克隆下来先构建一次（构建产物不入库）

仓库里**不带构建产物**。两处产物都由 `npm run build` 从源码打出来，都在 `.gitignore` 里：

- `dist/` —— 扩展自己的 bundle，以及装配用的插件 bundle（`dist/assembly/plugins/`，扩展运行时读的就是这里）；
- `packages/*/lib/` —— 自有插件包的产物（浏览器侧 `lib/client.js` + 宿主半 `lib/index.js`），扩展运行时**不**读这里，它只在「把包装进 dsh profile」与发布包里才有意义。

为什么这么定：这些是生成文件。入库等于每个并行分支都重建同一份字节，合入时冲突就落在生成文件上——产物文本没法手改，只能取一侧再按合并后的源码重建（#102 rebase 到 #104 之后就是这么收尾的：专门一个提交「重建 dsh-workspace-tree 产物」）。不入库之后，冲突只可能落在源码上。所以按源码走，产物谁需要谁先构建——新克隆或清空产物之后：

```bash
npm install
npm run build      # 打出 dist/ 与 packages/*/lib/
```

**按 npm script 跑的命令会自己兜底**：`npm test` 与 `npm run verify:*` 都先挂一条 `npm run build`，新克隆直接跑不会缺文件。只有直接跑 `node test/xxx.test.ts`、`node scripts/verify-xxx.mjs` 这种绕过 npm script 的方式会遇到缺产物——那几条脚本开头会指名道姓说缺哪些文件、该跑什么（实现在 `scripts/check-build-artifacts.mjs`），不会静默失败。

## npm scripts

| 命令 | 干什么 |
| --- | --- |
| `npm run build` | `node build.mjs`：esbuild 把 `src/extension.ts` 打成单文件 `dist/extension.js`（cjs、target node22、`vscode` external、带 sourcemap），同时打出自有插件包的产物 `packages/*/lib/` 与装配用的 `dist/assembly/plugins/`。有 warning 会以非零码退出。产物都不入库，见上一节。 |
| `npm run typecheck` | `tsc --noEmit`。注意 import 都带 `.ts` 后缀（`allowImportingTsExtensions` + `verbatimModuleSyntax`），新增 import 要遵守。 |
| `npm test` | 先 `npm run build`（产物不入库，见上一节），再 `node --test test/*.test.ts`，只覆盖 `src/pure/`。改 pure 模块必须跑。 |
| `npm run verify:lab` | 先 `npm run build`，再用 Playwright 跑装配的**浏览器验证**（harness 在 `test/assembly-lab/`）：四棵树在真实 dsh 网关（只读）上零槽位崩溃/零缺失契约、三树冒烟渲染、关键交互、侧栏树与官方外观逐项对齐、宿主能力口语义。需要本机有在跑的 dsh 网关（缺省 3080，token 读 `~/.dsh/dsh-owned.json`）；产物在 `test/assembly-lab/out/`（gitignored）。改装配相关代码后必跑，细节见 `test/assembly-lab/README.md`。 |
| `npm run verify:clean-profile` | 干净 profile 门禁（#165）：在临时目录里起一个全新 `DSH_HOME`、把 `packages/` 下的自有插件包装进 profile、再起一个独立端口的 dsh，然后用装配实验室那套装配页逐棵树打开，核对「干净 profile 上装配页能起来」（不读 `~/.dsh/dsh-owned.json`、不碰你正在跑的实例，跑完按 PID 收掉）。细节与为什么要单列一条见 `test/assembly-lab/README.md`。 |
| `npm run verify:install-guide` | 用 Playwright 跑**宿主侧那两页**的冒烟（harness 在 `test/install-guide/`）：安装引导 tab（按钮/下拉含选中态与外链/命令随平台更换/复制成功与失败反馈/分段切换）与侧栏状态页（未安装/启动中/未运行/启动失败/装配失败各自画成什么样、按钮发什么消息），页面都由真实宿主代码渲染（`vscode` 顶上假实现），明暗两态各跑一遍并留截图。不需要网关（这两页都不参与装配树）；`SMOKE_LOCALE=zh-cn` 用真中文译文渲染，产物在 `test/install-guide/out/`（gitignored），细节见 `test/install-guide/README.md`。状态页跟随服务状态变化（宿主侧订阅）由 `npm test` 的 `test/sidebarStatusPage.test.ts` 覆盖。 |
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
- **UI bug 不适用**：渲染/布局/交互单测测不到。改为：**装配相关的 UI 断言写进浏览器验证套件**（`test/assembly-lab/`，跑 `npm run verify:lab`——页面由仓库真实模块构建、数据面是真实网关只读、宿主是假宿主，快且可复跑，是常驻防线）；**宿主侧普通页面**（安装引导 tab、侧栏状态页）的 UI 断言写进 `test/install-guide/`（跑 `npm run verify:install-guide`，同样用 Playwright，不需要网关）；宿主行为（webview CSP/剪贴板/原生菜单等）与需要人眼的观感核对走 VS Code 验证（`scripts/dev-ui-test.sh`）或 `test/sandbox/` 沙盒（见 `test/sandbox/README.md` 的「验收口径」）。合入验收 = dev-finish 产出的测试报告（人审，见 `worktree-dev-flow` skill 流程 5），对功能有疑问才人工开窗 `dev-ui-test`。

## 手动模拟异常场景

- **未安装 dsh**：临时把 PATH 里的 dsh 摘掉（或把 `dshOne.dshPath` 指到不存在的路径），打开面板应报"未找到 dsh"并引导安装。
- **验证复用语义**：先手动 `dsh web --port 3080` 起一个实例，再打开面板，状态栏 tooltip 应显示"已复用已有实例"，关闭 VSCode 后该实例应仍在运行。

## 日志与事后取证（面板消失这类宿主行为）

扩展的日志有两个落点：

1. **输出面板**（VS Code 里「输出 → DSH One」），也是命令 `dsh-one: Show Logs` 打开的那一份；
2. **文件**：`<扩展 globalStorage>/logs/dsh-one-<进程号>.log`。macOS 上的完整路径是

   ```
   ~/Library/Application Support/Code/User/globalStorage/cgeng.dsh-one/logs/dsh-one-<pid>.log
   ```

   扩展激活时会把自己的路径写进日志第一行（`log file: …`），找不准就打开输出面板看首行。

为什么要有一份文件：窗口重载 / 扩展宿主重启这类事发生在扩展之外，出问题后只能靠日志自证，而 VS Code 自己那份日志（它自己目录下的 `output_logging_…`）路径随版本和窗口变、还会被清理。这份文件的约定：

- **一窗一文件**，文件名带进程号——**扩展宿主重启 = 一个全新文件**，所以要找「刚才出问题的那个窗口」，看 `logs/` 下修改时间最新的那个文件；
- 单文件超过 2 MB 轮转到 `xxx.log.1`，只留一份上一版（要看的通常是最近那段）；
- 写不进去（目录权限等）就自动关掉自己，不影响扩展任何行为。

对话面板的生命周期在这个文件里可以逐条对着读（关键字 `chat panel`）：

| 行 | 含义 |
| --- | --- |
| `chat panel created: kind=singleton\|tab session=…` | 面板建立（单例 / 多开标签页） |
| `chat panel replaced: session=… -> …` | 单例被**我们自己**替换掉（新面板顶掉旧面板） |
| `chat panel disposed: kind=… session=… reason=replace\|other` | 面板被销毁。`replace` = 上面那条替换；`other` = 用户点关闭 **或**扩展宿主收摊 |
| `chat panel restoring: … saved=yes\|no` | 窗口重载后 VS Code 把标签页交回来，开始按存下的状态重装（`saved=no` = 这个面板没存过状态，按默认面板恢复） |
| `chat panel restored: kind=… session=…` | 恢复成功 |
| `chat panel restore failed: …` | 恢复时装配不起来，面板里落的是状态页（可重试） |
| `window focus: focused\|blurred` | 窗口焦点变化（用户报的「切走再回来」在这里对时间点） |
| `dsh-one deactivating (extension host shutting down)` | 扩展宿主收摊（重载 / 退出）——**这条是「面板被宿主带走」的铁证** |

读一份日志时：

- 日志末尾有 `deactivating`、其后又是一份新 pid 的文件 → 那次是**宿主重启**（重载 / 退出），面板是被宿主带走的；
- 只有 `chat panel replaced`、没有 `deactivating` → 是**我们**换了单例（例如侧栏点了另一个会话），不是宿主；
- 有 `disposed … reason=other` 但整份文件里没有 `deactivating` → 用户点了关闭，或者宿主是崩的（崩了不会调 deactivate）。

## 人工验收：面板在重载 / 切窗口之后还在（#169）

这条只能人开真窗口验（宿主行为，浏览器验证到不了）。扩展自己不能起窗口，所以由人跑：

1. 起 dev host（`scripts/dev-ui-test.sh`，或 VS Code 里按 F5），确认侧栏亮了、对话面板 tab 开着，看一眼该面板当前是哪个会话；
2. 命令面板跑 **Developer: Reload Window**，等窗口起来：
   - 期望：对话面板 tab **还在**，内容回到**同一个会话**（历史/composer 都在）；
   - 期望：多开的标签页（会话行菜单「在新标签页打开」开的那些）也各自回来，落在各自的会话；
   - 期望：日志（见上一节）里能看到 `chat panel restoring` → `chat panel restored`；
3. 再验一次「切走窗口再回来」：切到别的应用（或别的 VS Code 窗口）几十秒再切回来，面板应原样还在（VS Code 不会因为焦点变化重载窗口，这条用于排除「我们自己把面板关掉」的可能）；
4. 降级分支（可选，验「不静默空白」）：把 dsh 服务停掉（命令 `dsh-one: Stop Service`）后再 Reload Window——面板 tab 应当还在，里面是「dsh 服务没在运行 / 启动服务」的状态页，点「Start the dsh service」应把面板装起来；
5. 会话已经删掉的情况：把某个会话归档/删掉，再 Reload Window——面板应弹一句「这个对话面板原来打开的会话已经不在了」，并且**不带那个会话**打开（不是一片空白）。

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
   npx vsce publish --packagePath dsh-one-<x.y.z>.vsix   # 发布已有 vsix 用 --packagePath（位置参数是版本号）；用 Release 下载的那份，不重新打包
   ```

注意：`package.json` 的 `"publisher"` 应是你发布的 marketplace 账号（现为 `cgeng`），发布前确认即可，无需修改。版本策略：每次发布 +1（正式版 patch+1，rc 按 rc.N 递增；首发 1.0.0），市场不可同版本重发。
