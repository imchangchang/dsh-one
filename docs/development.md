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
| `npm run verify:lab` | 先 `npm run build`，再用 Playwright 跑装配的**浏览器验证**（harness 在 `test/assembly-lab/`）：实验室**自己起一台隔离实例**（临时 `DSH_HOME`、随机端口、经官方 RPC 播种真工作区与会话、跑完按 PID 收掉），整轮对着它跑——四棵树零槽位崩溃/零缺失契约、三树冒烟渲染、关键交互、侧栏树与官方外观逐项对齐、宿主能力口语义。**不需要本机有在跑的 dsh 网关**（用户日常那台只被只读探测两次）；要连外部实例用 `--gateway <url>`（那时按只读对待）。产物在 `test/assembly-lab/out/`（gitignored）。改装配相关代码后必跑，细节见 `test/assembly-lab/README.md`。 |
| `npm run verify:lab-version <版本>` | 把**指定版本的 dsh** 装到临时目录、用它跑同一套浏览器验证（缺省只跑 F-01 CONTRACT），跑完删掉那份安装——**本机已装的 dsh 一个字节不动**。用途是接新版本时的门禁：探针只读字节，看不见「整棵装配起不来」（0.1.6-alpha.2 就是这样整页白的），只有真页面在那个版本上跑一遍才知道。细节见 `docs/dsh-compat-checklist.md` 的「装配面」一节。 |
| `npm run verify:clean-profile` | 干净 profile 门禁（#165）：在临时目录里起一个全新 `DSH_HOME`、把 `packages/` 下的自有插件包装进 profile、再起一个独立端口的 dsh，然后用装配实验室那套装配页逐棵树打开，核对「干净 profile 上装配页能起来」（不读 `~/.dsh/dsh-owned.json`、不碰你正在跑的实例，跑完按 PID 收掉）。细节与为什么要单列一条见 `test/assembly-lab/README.md`。 |
| `npm run verify:install-guide` | 用 Playwright 跑**宿主侧那两页**的冒烟（harness 在 `test/install-guide/`）：安装引导 tab（按钮/下拉含选中态与外链/命令随平台更换/复制成功与失败反馈/分段切换）与侧栏状态页（未安装/启动中/未运行/启动失败/装配失败各自画成什么样、按钮发什么消息），页面都由真实宿主代码渲染（`vscode` 顶上假实现），明暗两态各跑一遍并留截图。不需要网关（这两页都不参与装配树）；`SMOKE_LOCALE=zh-cn` 用真中文译文渲染，产物在 `test/install-guide/out/`（gitignored），细节见 `test/install-guide/README.md`。状态页跟随服务状态变化（宿主侧订阅）由 `npm test` 的 `test/sidebarStatusPage.test.ts` 覆盖。 |
| `npm run package` | 先 build，再 `vsce package` 打出 `.vsix`（`.vscodeignore` 排除了 src/test/node_modules 等，VSIX 里只有 dist + 清单 + 图标等）。 |

## 合入门禁（dev-merge 在 rebase 之前跑的静态自检）

主线跑 `scripts/dev-merge.sh <slug>` 合入任务分支时，在 rebase 之前会依次跑两道静态自检；任一道不过就**拒绝合入**（不改分支、不留半个状态）。两道自检的**合并基点都跟随集成线**（`MERGE_TARGET`，默认 `main`）——不用 `COMPAT_BASE` / `I18N_BASE` 跟着换的话，合 `develop/*` 这类长期分支时会把整条分支与 `main` 之间的历史改动当成「本次新增」，造成成片的误报。

- **i18n 自检**：`scripts/check-i18n.sh`（宿主层 `vscode.l10n.t` 的 key、webview 层 `t()` 的 key、`package.json` 的 `%key%`、对外 README、源码里的硬编码中文）。
- **平台兼容性自检**（#6）：`scripts/check-platform-compat.sh`。

两道都可以单跑（`bash scripts/check-platform-compat.sh <分支>`，exit 0 = 过、1 = 拒绝合入、2 = 用法错），要换基点用 `COMPAT_BASE=<分支>`：

```bash
scripts/check-platform-compat.sh agent/my-task                 # 基点默认 main
COMPAT_BASE=<集成线分支> scripts/check-platform-compat.sh agent/my-task   # 集成线不是 main 时（历史上用过 develop/cordis-chat，该线 2026-09-19 已合入 main）
```

### 平台兼容性自检要什么

它只看**本次新增的代码行**（相对合并基点），命中下面两类形状时要求任务提交一份声明：

1. **平台路径**：`process.platform` 分叉；平台专属命令（`lsof` / `netstat` / `wmic` / `/proc/` / `ps -p` / `taskkill` / `powershell` / `cmd.exe` / `ComSpec` 等）；进程信号（`process.kill`、`SIGTERM` 一类）；路径分隔符与平台 shim 后缀（`path.sep`、`path.win32/posix`、反斜杠归一化写法、`.cmd` / `.exe` / `.ps1`）；子进程 `stdio` 与输出相关开关（`windowsHide`、`detached: true`、`shell: true`）；行尾处理（`\r` / `os.EOL`）。
   命中即要求**逐条**声明「这条平台路径在哪验证过」。这是「macOS 上开发测不出来」的直接对策：Windows 才现形的问题（就绪行时序、spawn 输出、`taskkill` 无优雅路径）只能靠写清覆盖来源来兜。
2. **按状态变量分叉的逻辑**：`existsSync` / `statSync` / `accessSync` 一类存在性探测与条件分叉同文件出现；「探测有没有结果」的分叉（赋值自一次调用、紧跟着按 `undefined` / `null` / 真假分叉，函数名或变量名带 `record` / `owned` / `port` / `token` / `file` 这类状态词）；`switch` 带 2 个以上 `case`；以及上面第 1 类里的平台分叉。
   命中即要求给出**分支矩阵**：把状态变量拆成几行，每行写清「分支条件 / 预期行为 / 验证方式」。`recover-token-no-record` 的教训就是只改了「有记录」那条分支、没走「无记录」那条，所以矩阵里任何一行写「未验证 / 待定」也会被拒。

### 声明写在哪、长什么样

一个任务一份，落在 `test/sandbox/verify.<slug>.platform.json`（`<slug>` 就是分支名去掉 `agent/` 前缀，与 [`test/sandbox/` 里的 ledger](../test/sandbox/README.md) 并排）。**没命中就不需要这个文件**。门禁拒绝时会直接把可复制的模板打出来：命中的 `file` / `rule` 已经填好，只需要换成实际内容。

```json
{
  "branch": "agent/my-task",
  "slug": "my-task",
  "platformCoverage": [
    {
      "file": "src/server/spawnDsh.ts",
      "rule": "child-stdio",
      "path": "Windows 上 detached + pipe 取输出（不落日志文件）",
      "verifiedBy": "real-machine",
      "evidence": "Windows 11 真机装 rc.4：启动会话后输出正常、无控制台闪窗"
    }
  ],
  "branchMatrix": {
    "trigger": "platform",
    "rows": [
      {
        "condition": "process.platform === 'win32'",
        "expected": "走 .cmd shim，detached 起进程",
        "verification": "Windows 真机（同上）"
      },
      {
        "condition": "darwin / linux",
        "expected": "直跑 node 入口，日志重定向到 logFile",
        "verification": "macOS 真机 + 单测 parseDshCommand"
      }
    ]
  }
}
```

字段口径：

- `platformCoverage[].file` / `.rule`：必须与门禁报出的命中**逐条对上**（`file` 是仓库相对路径，`rule` 就是门禁输出的 `rule=...`，即 `platform-branch` / `platform-command` / `signal` / `path-sep` / `child-stdio` / `line-endings`）。
- `.path`：这条平台路径是什么（人话描述，方便人工审查时对照）。
- `.verifiedBy`：**只能**填 `ci-runner`（CI runner 上跑过）/ `real-machine`（真机手动跑过）/ `unit-test`（平台解析或行为单测覆盖）/ `not-a-platform-path`（命中但确非平台路径，须同时给非空 `reason`；门禁会打 ⚠ 交人工复核，不算静默通过）。
- `.evidence`：证据本身——CI 的 workflow / job 名、哪台真机与什么步骤、测试文件与用例名。空着会被拒。
- `branchMatrix.rows[]`：`condition`（分支条件）/ `expected`（这条分支的预期行为）/ `verification`（怎么验证的）。三样缺一不可，`verification` 写「未验证 / 待定 / TBD」这类占位词也算缺。
- `branch` 必须等于当前待合分支（防止把别的任务的声明抄过来）。
- **只命中状态分叉、没有平台路径**时，`platformCoverage` 留空数组即可（模板会自动留空）；反过来只有平台路径、没有状态分叉时，`branchMatrix` 那段的 `rows` 留空也放行。

已经声明过、但后来在新增行里消失的条目只告警不拦（多半是代码已改，声明该顺手删），门禁会把它们打出来供人扫一眼。

### 命中判据是数据，不是硬编码

规则写在 `scripts/platform-compat-rules.json`：每条规则带 `examples`（必须命中的真实写法）与 `counterExamples`（必须不命中的易误伤写法），扫描与校验的实现在 `scripts/platformCompatScan.mjs`（纯函数），两者由 `npm test` 的 `test/platformCompatGate.test.ts` 钉住——那份测试还包含**端到端负向对照**（在临时 git 仓库里造分支，跑真门禁脚本，断言「命中没声明 → 拒绝」「补上 → 放行」「不命中 → 不受影响」「缺矩阵 → 拒绝」）。匹配前会先剥注释（TypeScript / JavaScript 走整文件状态机，shell 与 PowerShell 按 `#` 逐行剥），所以注释里提到 `taskkill`、`process.platform` 不会命中；`docs/`、`test/`、`.md`、构建产物不在扫描范围内（文档里的命令举例、测试夹具不算平台路径）。要加平台写法（比如新出现某个平台专属命令），改规则数据 + 补一条用例即可。


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
- **UI bug 不适用**：渲染/布局/交互单测测不到。改为：**装配相关的 UI 断言写进浏览器验证套件**（`test/assembly-lab/`，跑 `npm run verify:lab`——页面由仓库真实模块构建、数据面是实验室自起的隔离实例（临时 `DSH_HOME`，跑完收掉）、宿主是假宿主，快且可复跑，是常驻防线）；**宿主侧普通页面**（安装引导 tab、侧栏状态页）的 UI 断言写进 `test/install-guide/`（跑 `npm run verify:install-guide`，同样用 Playwright，不需要网关）；宿主行为（剪贴板 / 原生菜单 / 多 webview 生命周期等；#188 查实宿主 webview 层不会给扩展页面施加 CSP，见 `docs/architecture.md` 的「日志与安全细节」）与需要人眼的观感核对走 VS Code 验证（`scripts/dev-ui-test.sh`）或 `test/sandbox/` 沙盒（见 `test/sandbox/README.md` 的「验收口径」）。合入验收 = dev-finish 产出的测试报告（人审，见 `worktree-dev-flow` skill 流程 5），对功能有疑问才人工开窗 `dev-ui-test`。

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

## 人工验收：实验室的默认跑法不碰你的机器（#177）

`npm run verify:lab` 零参数现在**自己起一台隔离实例**（临时 `DSH_HOME` + 随机端口 + 播种真数据），
跑完按 PID 收掉。它不许碰你的 `~/.dsh`、不许碰你日常那台实例（缺省 3080）。要人工确认这一条：

1. **跑之前先取两次读数**：

   ```bash
   ls ~/.dsh                                    # 目录内容与时间戳
   ls -d /var/folders/*/*/T/dsh-lab-home-* 2>/dev/null   # 临时 DSH_HOME（本机 tmp 目录）
   lsof -nP -iTCP:3080 -sTCP:LISTEN             # 你日常那台实例，记下 pid
   ```

2. 跑整轮：`npm run verify:lab`（约十几分钟）。**期望**：报告里的 **R-06** 通过；跑的中途
   `~/.dsh` 一个字节不动、你的实例 pid 不变（可以另开一个终端反复 `ls -la ~/.dsh` 看）；
   桌面上**不该**出现访达窗口（原生副作用那一类只观察不点，见 `test/assembly-lab/README.md`）。
3. **跑完再看一遍**：

   ```bash
   pgrep -fl "dsh web"          # 期望：只剩你自己那台（3080），没有别的
   ls -d /var/folders/*/*/T/dsh-lab-home-* 2>/dev/null   # 期望：空
   ls ~/.dsh/dsh-owned.json     # 期望：没被动过（那文件是扩展记 spawn/adopt 实例用的）
   ```

4. **Ctrl-C 也要收干净**：再跑一次，中途按 Ctrl-C（退出码应是 130），然后重复第 3 步——
   期望一样干净。报告里 R-06 会把「隔离实例按 PID 收掉 / 端口释放 / 临时目录删掉」逐条列出来。
5. **人工排查连外部实例**（可选）：`npm run verify:lab -- --gateway http://127.0.0.1:3080`
   （手工起的实例再加 `--token <token>`）。那时**不自起实例、不播种**、按**只读**对待；
   想让它长期开着给人点页面就 `--headed --keep`（浏览器窗口会开在你桌面上，看完自己关）。
   连外部实例还会多跑一条默认跑法跑不了的判据：**F-59 的「真实卡片层」**——它要网关上真有
   第三方插件（`@dsh-external/dsh-visualize`）渲染出来的 HTML 预览卡，隔离实例里没有那个插件
   （默认跑法里那一层只记一条事实，用户报的坏法由套件自己的夹具卡覆盖，见 #193）。

### 怀疑机器上有孤儿实例时：`scripts/lab-doctor.sh`（#192）

上面第 3 步那两条读数就是手工版的巡检。要经常看、或者想顺手收掉，跑这条脚本：

```bash
scripts/lab-doctor.sh          # 只报不动：列出候选实例（各自的性质与理由）、临时目录，以及你自己那台
scripts/lab-doctor.sh --kill   # 确认无误后真收
```

它认得的「自起实例」是命令行长成 `dsh web … --no-open` 的进程。**能不能收**要四条同时成立：
命令行是那个形状、`DSH_HOME` 是本机临时目录下按实验室前缀（`dsh-lab-home-` / `dsh-lab-fresh-home-` /
`dsh-empty-gateway-`）建出来的、pid 与端口都不是 `~/.dsh/dsh-owned.json` 里登记的那台、父进程已经
没了。**用户自己那台永远不满足第二条**（它用的是 `~/.dsh`），所以哪怕登记文件读不出来也不会被收。

退出码：0 = 干净，1 = 还有孤儿，2 = 用法错或当前平台跑不了（这套判据要在 macOS / Linux 上跑）。

为什么需要它：收尾链本身已经在 #177 / #190 / #197 修齐了（跑完、断言失败、Ctrl-C、SIGTERM
都收得掉），但**进程吃 `SIGKILL` 是收不了的物理事实**——信号根本没有机会进我们的收尾代码，
父进程一退它就归 init 收养（PPID 变 1）。这类残局只能事后发现、事后收，这条脚本就是那对眼睛。

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

## 人工验收：改了自己的插件重建之后，Reload Window 就能看到新界面（#173）

**这条为什么必须人验**：整包（`/plugins-local/??…`）的 URL 就是 webview 的缓存键，缓存头是
`max-age=86400, immutable`（源稳定时跨 tab 命中 HTTP 缓存，见 `src/server/assemblyMirror.ts`）。
改之前这个键只含**网关**那个版本号，我们自己重建 `dist/assembly/plugins/<id>/client.js` 时
URL 一字不变 → webview 连条件请求都不发，改了样式 reload 也看不到（用户 2026-09-17 实测，
issue #173）。现在 rev 是 `<网关版本>-<本地产物内容哈希>`（`wireFilter` 的 comboRev +
`src/server/localBundleRev.ts`），本地产物一变缓存键就变。

跑法（人开真窗口）：

1. 先 `npm run build`，起 dev host（`scripts/dev-ui-test.sh`，或 VS Code 里按 F5），确认侧栏（或对话面板）装起来了；
2. 随便改**一行侧栏样式**：例如 `packages/dsh-workspace-tree/src/workspaceTree/styles.ts` 里标准档的
   `rowRadius: '8px'` 改成 `'12px'`（工作区行 / 会话行的圆角，肉眼可辨）；
3. `npm run build`；
4. 在 dev host 窗口跑命令面板的 **Developer: Reload Window**（等窗口起来）；
5. **期望**：侧栏的行圆角立刻是新值。**不需要**重启 dsh 服务（`dsh-one: Restart Service`），
   也不需要等缓存过期——改之前这两步是唯一的出路，这正是本条要守的事。
6. 想留证据的话看 webview 的 devtools（命令面板 `Developer: Open Webview Developer Tools`，
   控制台里执行下面这段），重建前后两次读到的 rev **前一段相同、后一段不同**：

   ```js
   performance.getEntriesByType('resource')
     .map((entry) => entry.name)
     .filter((name) => name.includes('/plugins-local/'))
     .map((name) => new URL(name).searchParams.get('rev'))
   ```

**边界（要人知道的）**：这条只保证「**Reload Window** 之后看到新的」（扩展升级后 VS Code 也是
整窗重载，所以用户侧同样覆盖）。窗口没重载、只把 webview 自己刷新一下（Developer: Reload
Webviews）时，页面拿到的还是**旧的那份 HTML 与旧 URL**，浏览器按旧 URL 命中 immutable 缓存，
看到的仍是旧界面——那种情况下仍需 Reload Window。把这一层也做成自动跟着变需要另想办法
（例如每次装配多一次往返换掉长缓存），不在本条范围内。

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
