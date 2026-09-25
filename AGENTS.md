# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 铁律：改代码前必须先建 issue + 开 worktree（违反即流程错误）

**主线（main）不写任何代码**，只负责测试、集成和合入。任何改动仓库文件的任务，动手写代码前必须先完成前两步：

1. **建/认领 backlog issue**：一条目一 issue，状态 = label（`b:open`→`b:doing`→`b:done`→`b:closed`）。没现成 issue 就 `gh issue create`（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**并 `gh issue view` 复核 assignee 是自己**。
2. **`scripts/dev-start.sh <slug>` 开 worktree**：在 `.worktrees/<slug>`（分支 `agent/<slug>`）里开发，不在 main 上改文件。

**限制与例外**：

- **只读分析**（读代码 / 查资料 / 分析问题 / 汇报，不新增不修改仓库文件）可以直接在 main 做，不触发流程。
- 反过来：**一旦决定落代码（新增/修改任何仓库文件），就从第 1 步重新开始**——分析阶段不用走，但绝不能「先改了再说」、事后再补流程。
- **凡改仓库自身约定/文档、且不涉及代码行为**（如本 AGENTS.md 本身、`docs/` 纯文档），可直接在 main 上改，不走 worktree（工作流无法 self-bootstrap）。

**提交前自查三问**（任一答不出 = 流程没走完）：这次改动在哪个分支？对应 backlog issue 是 #几？`dev-finish` 打过 done 标记了吗？

并行开发全流程见 skill **`worktree-dev-flow`**。

## 并行开发：一律 worktree

**主线（main）不写任何代码**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（正本在 `.agents/skills/worktree-dev-flow/`，随仓库走，DSH 等项目级 skill 机制自动加载；`scripts/` 下五个脚本已按本仓库适配，含 `main-lock.sh` 主线写锁——任何会写 main 的操作必须先拿锁，`dev-merge.sh` 已内置）。不支持 skill 的环境：直接读那个目录里的 `SKILL.md`，或跑 `scripts/dev-start.sh --help` 起步。

**worktree 开发 session 只开发、不合入**：dev-finish（自测 + 生成测试报告 + done 标记）通过后即止，合入由主线 agent 跑 `dev-merge.sh`。**合入门禁 = 静态自检 + 测试报告审查**：`dev-merge.sh` 在 rebase 之前依次跑两道静态自检（i18n、平台兼容性，见下），报告由 `test/sandbox/` 的 ledger + `report.mjs` 产出（新增功能项在前、现有功能回归在后，每项带期望/截图/通过或失败结论），人工审查通过再合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收。

**平台兼容性自检**（#6，2026-09-18 起，`scripts/check-platform-compat.sh`）：待合入分支相对集成线的新增行里出现平台相关代码（`process.platform` 分叉、平台专属命令如 `lsof`/`netstat`/`taskkill`/`powershell`/`/proc/`、信号 `process.kill`/`SIGTERM`、路径分隔符与 `.cmd`/`.exe`/`.ps1` shim、子进程 `stdio`/`windowsHide`）时，任务**必须**提交 `test/sandbox/verify.<slug>.platform.json`，逐条声明「这条平台路径在哪验证过」（`verifiedBy` = `ci-runner` / `real-machine` / `unit-test`）；新增行里出现**按状态变量分叉**的逻辑（存在性探测 + 条件分叉、探测结果「有/无」分叉、`switch` 多分支、平台分叉）时，同一份声明里还要给 `branchMatrix.rows`（每行：分支条件 / 预期行为 / 验证方式，写「未验证」这类占位词同样拒绝）。缺项**拒绝合入、不降级**，脚本会打印命中位置、缺什么、以及可复制的模板。格式、判据与本地跑法见 `docs/development.md` 的「合入门禁」一节。

**动了 workspaces 面就要装依赖**（#187，2026-09-18 实测踩过）：插件包之间按**包名**互相引用（`@dsh-one/dsh-plugin-kit/<模块>`），这些链接由 `npm install` 建在 `node_modules/@dsh-one/` 下。所以**新增插件包 / 改包名 / 改包内子路径导出**之后，任务 worktree 里必须**先 `npm install` 再自测**（否则 build 挂在 `Could not resolve "@dsh-one/…"`；只在自己装过依赖的机器上自测会得到假绿）。`dev-merge.sh` 侧已内置：合入范围动过 `package.json` / `package-lock.json` / `packages/*/package.json` 时它会先 `npm install` 再重建产物，重建失败会**响亮报错并指出修法**（不会留下"已合入但产物没重建"的静默坏状态）。

**验证四层与跑法**（2026-09-16 起，浏览器验证 harness 已入库）：**浏览器验证**（`npm run verify:lab`，harness 在 `test/assembly-lab/`）用 Playwright 打开装配页跑断言——页面由仓库真实模块构建、数据面是本机真实 dsh 网关（只读）、宿主侧是假宿主，**本机整轮约 15 分钟**（实测 899 / 938 / 942 秒；只跑某个套件用 `--suite <套件号>`，几十秒），是**第一道**，改装配相关代码（block list / 树定义 / 自有插件 / mirror / pageHtml）后必跑；**官方 web 真机**（`npm run verify:plugins-official`，脚本 `scripts/verify-plugins-official.mjs`）在隔离的临时 HOME + 临时 profile 里把自有插件包装进 profile，用 Playwright 打开**官方页面本身**验加载与行为，约 2 分钟，改插件包（`packages/dsh-*` 的清单/产物/补丁）后必跑；**VS Code 验证**（`scripts/dev-ui-test.sh`）起隔离 VS Code 窗口实测 webview 宿主层（CSP/剪贴板/原生菜单/多 webview 生命周期），慢，是**最终准绳**；**沙盒**（`test/sandbox/run-sandbox.sh`）在 code-server 里装真插件 vsix 做宣发截图与人工核对。四者不互相替代（实验室验的是我们的装配页、真机验的是官方页面）。跑法与套件清单见 `test/assembly-lab/README.md` 与 `docs/plugin-packages.md`。

**宿主能力的改动不能只靠实验室验（2026-09-25，#247）**：实验室的宿主侧是**假宿主**（`test/assembly-lab/fakeHost.ts`），它自己应答能力调用，验到的只是「页面叫得动」那一半；**真宿主那份 deps 拼装**（`ui/assemblyView.ts` 的 `hostBridgeDeps()` —— 把哪个面板的哪几条能力搬进 deps）它从头到尾跑不到。#247 就是这么穿透的：`openPlugins` 没被搬进 deps，用户点侧栏那条「插件」行永远得到 `unsupported`，而实验室与真机脚本全绿。所以凡动宿主能力（`HostBridgeDeps` 的键、`HOST_CALLS` 白名单、各面板 `panelActions` 的注入）的改动，除了实验室，**必须有一条走真 deps 拼装/真宿主代码的单测**——常驻实现是 `test/hostCapabilityDeps.test.ts`（`test/chatPanelLiveness/` 的假 vscode 模块钩子下真跑 `hostBridgeDeps()`，外加一条端到端）。

**起真 VS Code 窗口只有人跑（agent 一律不许自己起）**：`scripts/dev-ui-test.sh` 或任何 `code --extensionDevelopmentPath …` 都会在用户桌面上真的弹出一个窗口、抢走焦点，而 agent 自己既看不见也点不了它；用户上一轮已经被弹窗打扰过（2026-09-16）。规则：
- agent 一律先用**浏览器验证**；改完装配相关代码跑 `npm run verify:lab` 就够，不要为了「看一眼」起窗口；
- **唯一例外**：问题落在浏览器验证覆盖不到的 webview 宿主层（CSP / 剪贴板 / 原生菜单 / 多 webview 生命周期），且**先告诉用户「接下来会弹一个窗口」**再起；
- 起了就**一次跑完立刻收掉**：`pkill -f "user-data-dir=/tmp/dsh-uidev/<slug>"`，不许反复起停（用户看到的是「一直弹出来」）；
- 隔离实例只写 `/tmp/dsh-uidev/<slug>/`，不碰用户的日常 VS Code 设置与扩展。

**上游契约面由每日探针覆盖（2026-09-16）**：`scripts/dsh-upstream-watch/` 的探针现含 24 项，其中**客户端契约面 4 项**（关键 slot 名、root 级 hooks 及其 `use*` props、我们取用过的官方标识符）与**官方产物面 3 项**（本机已安装官方包里的内部标识符；我们取用的 26 枚图标的导出名——官方 0.1.7-alpha.2 把图标名整批换了一代写法，按老名字取用会静默变 `undefined`、渲染时才炸成 React #130，见 #236；三棵树 block list 的服务依赖补全——少了哪一条会让整页 boot 失败，#227）——失败信息带版本、缺失名、期望出处与我方使用点。每次上游发版另跑 `npm run verify:lab` 与 `npm run verify:host-half`。结论：**契约漂移由探针在 CI 发现，而不是由用户日常使用撞见**。已实测版本见 README 的「dsh version tracking」表，三种状态分开写：**实测通过** = 0.1.5-rc.2（版本门下界） / 0.1.5-rc.3（npm `latest` = `next` 今天指的版本）/ 0.1.6-alpha.1 / 0.1.6-alpha.2；**实测不通** = 0.1.2-rc.1、0.1.7-alpha.2；**未验过** = 其余。逐版本读数与红项见 `docs/dsh-compat-checklist.md` 的「支持的 dsh 版本」。

**集成线**：默认 `main`。`#11` 系列（Preact 迁移 + 对齐官方 dsh web）已于 2026-09-10 归档关闭：改动整线保留在 `develop/dsh-web-alignment`（远端同名分支），**仅作参考代码，不再开发、不再合入**；该系列 issue（#2/#11/#29/#40-#58 中相关条目）已关闭，真实问题重新梳理顶层结构后另立新 issue。`scripts/dev-merge.sh` 的 `MERGE_TARGET=<分支>` 能力保留（默认 `main`），两道静态自检（`check-i18n.sh` / `check-platform-compat.sh`）的合并基点都跟随目标分支。

**验证线 `develop/cordis-chat`（已结束：2026-09-14 起 → 2026-09-19 整线合入 `main`）**：对话区官方 cordis 组件装配的验证线（#60 v1 整壳嵌入验收失败退回 `b:open` 后另立），条目 = #63（spike）→ #64（goal 1：对话区官方组件装配、侧栏保持自研）→ #65（goal 2：特有功能插件化）→ #66（goal 3：通用组件上游化）。整线已于 2026-09-19 合入 `main`（merge `9fbc5da9`）：**集成线回到 `main`**，此后任务照 `MERGE_TARGET=main`（默认）合入、发布也从 `main` 出；分支 `develop/cordis-chat`（本地与远端）只作历史保留，不再开发、不再合入。

**本线用词铁律——不准造词**：下表术语是唯一标准说法，issue、comment、汇报、代码注释、文档、对话里一律用标准词，禁止自造缩略词或新词（反面教材：「剥段」→ 标准词「插件整包过滤」）。现有词表表达不了的概念，先用一句平实的话说全、再登记进本表；宁可多写几个字，不让读者猜。

**官方机制名词直接写英文原词（用户铁律，2026-09-16）**：官方已有的机制名词（`slot` / `shadow` / `seam` / `combo` / `shell` / `staticModules` 等）**标准写法就是英文原词**，不要硬译成中文——译名要么不准确、要么需要额外解释（反例：把 `seam` 译成「接缝」，读者无法从中文反推官方概念）。中文只在**首次出现处**用括号作一句平实解释；我方工程词（如 `hostCall`/`hostResult`、loopback 代理）同样优先用代码里真实的标识符，而不是另起比喻名。

**文档说人话**：写给谁看就按谁的常识写——完整句子、不用电报式省略（禁「编排：取清单 → 过滤 → 起代理」式写法）、术语第一次出现时用一句日常话解释（代码标识符除外，用 code 标记）、讲理由就用「因为…所以…」的日常逻辑。写完自己读一遍，凡是需要猜的地方都改成人话。

**约定俗成的写法优先，没有通行中文译名的直接写英文原文（用户铁律，2026-09-20）**：选词按这个顺序——① 官方或业界已有的**标准写法**：官方机制名词照下面那条用英文原词；标准缩写用**大写原形**（`UI` / `API` / `CLI` / `RPC` / `HTTP` / `WS` / `JSON` / `npm`），代码标识符、包名、文件名、URL 除外；② 有**通行中文译名**的用通行译名（如 `repository` → 仓库、`commit` → 提交）；③ **没有通行中文译名的直接写英文原文**（`combo` / `seam` / `shadow` / `slot` / `roster` 这类），不硬译、不自造中英混排的新词。拿不准就照官方文档与官方源码注释里的写法写。

**文档里不要 AI 味（用户铁律，2026-09-20）**：文档是给用户或接手开发的人看的，判断标准是「读的人能不能拿它去干活」，不是读起来顺不顺。删掉填充与套话（「值得注意的是」「总而言之」「首先 / 其次 / 最后」「让我们」「赋能」「助力」「全方位」「深度」），不写排比，不用 emoji，不为显得全面而堆同义词；一段说清一件事，长句拆短；能写具体读数与标识符的地方不写形容词（「提升很大」→ 写出实测读数）。

**官方机制优先，禁 hack（用户铁律）**：改官方组件的行为或呈现，必须按以下优先序选机制，禁止跳序走捷径——

1. **官方槽位机制**：槽位贡献（slots.inject 对既有槽位名）与遮蔽（shadow：同名单独注册 + 更低 priority，官方注册表原生支持）；
2. **官方服务 API**：cordis ctx 上各服务的公开方法（如 theme 服务的 register/setTheme、settingsSchema、locale 字典注册）；
3. **官方预留 seam**：`__DSH_TRANSPORT__`、`__DSH_BOOT__` 清单、种子表、dsh.client 插件声明格式、`__DSH_BOOT_READY__`；
4. **CSS / DOM 手段**：**仅当**上述机制经读官方源码确认不存在时可用，且必须注释写明：官方无对应机制的证据（在哪个文件查过）、所用类名/结构在官方版本变化下的稳定性风险。

动手前先读官方源码确认机制存在与否；每个改动在提交信息或注释里注明走的是第几层机制。反例（禁止）：DOM 遍历模拟点击、改官方产物字符串、把 localStorage 恢复键当协调通道、无依据的 CSS 哈希类名硬盖。

**优先与官方插件共存，不顶替其角色（用户铁律，2026-09-16 因事故确立）**：改框架级行为时，优先「**加载官方件 + 只遮蔽（shadow）要改的那一个槽位**」，让官方件提供的契约（服务、槽位注入、钩子）原样存活；**禁止**用 block list 整体移除官方框架插件再由自有插件顶替其角色——那等于接手一份隐式、不版本化的内部契约，官方内部演进（如 0.1.6 新增下发给槽位的钩子 `usePanelInfo`）会让替代品静默崩坏。仅当官方件与目标形态**不可调和**时才允许 block，且必须在注释里写明：试过哪些共存路径、为何不可调和、接手了它哪些契约、这些契约如何随版本核对（上游探针覆盖）。

**底座的契约完备性（用户铁律，同一事故）**：底座（我们的 shell 实现——VS Code 侧的页面运行时 + 传输 + 渲染覆盖；**「shell」是官方概念，指提供页面运行时与传输的那一层**，见词表）与底座之上的插件，责任必须分开——
- **底座**：负责提供官方框架插件（renderer / layout / sidebar 等）对其它插件承诺的全部契约（服务、槽位注入、钩子、启动 seam）。官方改**树本身怎么搭**时底座跟着跟进，这是可接受的成本。
- **底座之上的插件**（官方插件与我们自研的官方格式插件）：**不得因为底座缺契约而失效**；只有官方对该插件自身做破坏性变更时才允许失效。
- 因此底座优先「加载官方框架插件、让契约由官方代码提供 + 我们只覆盖渲染与传输」，而不是自己重写框架件的角色；并且验证集里**必须有底座契约完备性断言**（每棵树在真实网关上零 `slot entry crashed`、零缺失钩子/服务），让缺口在验证阶段暴露，而不是在用户日常使用中暴露。**这条断言的常驻实现 = `npm run verify:lab` 的 CONTRACT 套件**（代码在 `test/assembly-lab/`，四棵树逐棵断言零崩溃、零未激活、关键槽位有内容；口径与跑法见该目录 README）。改装配相关代码（block list / 树定义 / 自有插件 / mirror / pageHtml）后必须让它跑绿。

**官方新增默认保留（用户铁律，2026-09-16）**：官方新版本带来的新插件与新功能，**默认保留**（按需声明它们要的槽位、在合理位置渲染），**不得因为「我们用不上」「体积大」「暂时有空转」而进入 block list**。只有**与我们的形态直接冲突**（例如官方外框、官方侧栏这类要占据同一视觉区域、与 VS Code 容器职责重叠的件）才允许处理，且必须在注释里写明冲突点；体积/流量问题优先用缓存与按需加载解决，不用裁剪功能解决。判断口径统一为：**保留官方给用户的能力，只收敛与 VS Code 容器冲突的呈现**。

**自有插件命名分两类（用户铁律，2026-09-16）**：`@dsh-one/vscode-*` = **只能在 VS Code 侧使用**（无法单独拿到官方用）；`@dsh-one/dsh-*` = **官方也能用**（可移植 / 双端）。新增插件先判定可移植性再命名；随可移植性改造（宿主半、独立于我们 frame 的挂载等）落地，插件应从 `vscode-*` 改名为 `dsh-*`，改名时同步 id / bundle 目录 / 清单 entry / 注释 / 测试。

**能移植的必须移植（用户铁律，2026-09-16）**：不允许「技术上做得到却留着专属」。凡可移植的插件，必须按改造路径落地为 `dsh-*`——两条通用改造路径：① 需要宿主能力（跑 git、落盘、对话框等）的 → 交由**宿主半插件**提供，前端插件只走抽象口；② 依赖我们自有 frame 挂载点（如 `[data-shell="dsh-one"]`）做事件委托的 → 改为**官方稳定容器/官方语义属性**派生的挂载点，使其不依赖任何自有 frame。只有**存在意义本身就是适配 VS Code 容器**的插件（渲染外框、宿主主题跟随、宿主中转与注入、把设置开成编辑器页等）才允许保持 `vscode-*`，且必须在文件头写明「为何不可移植」。

**自有插件命名（用户铁律）**：dsh-one 自有 cordis 插件一律命名在 **`@dsh-one` 作用域**下，形式为 **`@dsh-one/xxxxx`**（如 `@dsh-one/vscode-chat-ui-layout`）——模块 id、bundle 目录名、清单 entry id、注释与文档引用全部一致；新增插件照此办理，不得使用其它作用域或裸名。

**可移植件必须是官方格式的 npm 包（用户铁律，2026-09-16，#73）**：可移植（`dsh-*`）的自有插件**必须**在 `packages/<名>/` 下有自己的包——包清单声明 `dsh.bundle.patch` + `dsh.client`（`platform: "web"` + `inject` + `external`）、`exports["./client"]` 指 `lib/client.js`，`cordis.patch.yml` 只 insert 自己一行；**包名 = 装配清单里的插件 id**（两处由 `test/pluginPackages.test.ts` 交叉核对）。`vscode-*` 那几件（渲染我们外框、调 VS Code 宿主、把设置开成编辑器页）不进 `packages/`，但文件头要写明为何不可移植。装包链路、字段作用与真机实测跑法见 `docs/plugin-packages.md`。新增可移植插件**必须**跑一次 `npm run verify:plugins-official`（官方页面真机），只跑装配实验室不算数——实验室验的是我们的装配页，不是官方页面。

**插件状态按官方惯例存储（用户铁律，2026-09-16）**：我们所有插件的状态，一律按 dsh 官方插件的方式存放，不得依赖 VS Code 的存储机制——
- **用户可感知的持久状态**（回收站名单、分组定义、标签、置顶等）→ 由**宿主半插件**拥有，落在 dsh 自己的目录（`~/.dsh`）下，经官方 RPC 机制暴露给前端插件；不允许放进扩展的 `globalStorage` / `workspaceState` / 扩展自建状态文件。
- **纯视图态**（展开折叠、排序、当前选中）→ 走客户端存储，沿用官方客户端既有惯例与键名风格（如 `dsh.*` 系列 localStorage），不另起第二套。
- **VS Code API 的状态存储（`globalStorage` / `workspaceState` / Memento）仅允许用于 shell 自身基础设施**：dsh 进程管理、loopback 代理生命周期、面板布局等，且代码里必须标注「shell 关注点，非插件状态」。
理由：① 双端复用（官方 web 拿不到 VS Code 的存储）② 与官方语义一致（dsh 插件的状态就该在 dsh 里）③ 避免同一份数据出现两套存储而漂移。存量偏差见条目 #82。

| 标准词 | 来源 | 含义 |
| --- | --- | --- |
| **shell** | **官方原词** | 官方注释原话「拥有不同物理传输的 shell 在此提供实现」——指**提供页面运行时与传输的那一层宿主环境**。我们的底座就是我们的 shell 实现。**不要**用它指代官方的框架插件（此前误用过） |
| **框架插件** | 我们工程词（指代对象是官方的） | 官方负责「把插件装起来、给出槽位与契约」的那几件：WebBoot 运行时、`ui-renderer`、`ui-layout`、`ui-sidebar`、传输层（`connection`/`api-gateway` 等）。此前误称「官方 shell」 |
| **外框插件（frame plugin）** | 我们工程词（对应官方 `AppFrame`） | 我们渲染页面外框的插件，三个 id 按官方 `@deepseek-ai/dsh-client-ui-layout` 的命名方式取：`@dsh-one/vscode-chat-ui-layout`（对话区）/ `@dsh-one/vscode-sidebar-ui-layout`（侧栏位）/ `@dsh-one/vscode-settings-ui-layout`（设置独立成页）（#97）；在新铁律下它的角色收敛为「遮蔽 root 槽位 + VS Code 渲染适配」。此前误称「shell 插件」（原 id `@dsh-one/vscode-shell` 等已按 #97 改名） |
| **宿主半（host half）** | **官方概念**（官方既有「插件有宿主半」的形态） | 跑在网关侧（dsh 宿主）的插件半，经官方 RPC 暴露能力与持久状态；官方格式包 + `cordis.patch.yml` 注册。作用：让前端插件不依赖 VS Code 宿主（可移植的前提） |
| **宿主能力口（host capability port）** | 我们工程词 | 前端插件请求宿主能力的**唯一入口**（SDK，`packages/dsh-plugin-kit/src/hostCapabilities.ts`）：VS Code 侧由扩展宿主实现（既有 hostBridge），官方侧由宿主半实现——**插件代码两端不改**。此前我自造的「能力桥」为非标准词，不再使用 |
| **slot**（槽位） | **官方原词** | 官方槽位系统的命名单元（如 `conversation.chat.node`）；注册条目按 priority 竞争上位。**标准写法用官方英文原词 `slot`**，中文「槽位」仅作解释；此前我自造的「座位」为非标准词，不再使用 |
| **shadow**（遮蔽） | **官方原词** | 同名 slot 再注册一个**更小优先号**的条目：官方条目仍在注册表、其服务与 slot 声明照常存活，但不再渲染（号最小者上位）。出处：官方注册表报错原文「register at a different priority to shadow it (lowest renders)」与 `registry.d.ts` 注释；spike #69 浏览器实测过。**标准写法用 `shadow`**，中文「遮蔽」仅作解释 |
| **seam** | **官方原词** | 官方给 shell 预留的扩展点：WebBoot `run(container, seams)` 的 seams 参数、`__DSH_TRANSPORT__`、`__DSH_BOOT__`、种子表等；官方注释原话「拥有不同物理传输的 shell 在此提供实现」。**无可用的中文译法，直接写 `seam`**（我此前自造的「接缝」「平台缝」均为非标准词，不再使用） |
| **宿主调用通道（hostCall/hostResult）** | 我们工程词 | 页面插件向扩展宿主请求能力（跑 git、读写文件、弹对话框等）的请求-应答通道，消息类型即 `hostCall`/`hostResult`；官方 web 侧由宿主半提供同类能力。此前我自造的「能力桥」为非标准词，不再使用 |
| **combo**（插件整包） | **官方原词** | 网关把全部前端插件的代码拼成一个大文件、一个网址一次性下发；网校对文件内容做校验，改名单重新申请会 404。**标准写法用 `combo`**，中文「插件整包」仅作解释 |
| **装配** | 我们工程词 | 用官方 dsh web 前端组件在我们的 shell 里组装出 VS Code 前端（代码在 `src/ui/assembly/`、`src/server/assemblyMirror.ts`） |
| **密度档（density profile）** | 我们工程词 | 界面几何/间距（行高、行间空隙、内边距、字号、按钮尺寸）的一整套取值。**官方档** = 官方 css-module 的原始值，是无人给偏好时的兜底；**VS Code 档** = 我们的 VS Code 侧栏外框（`@dsh-one/vscode-sidebar-ui-layout`）在容器上下发的紧凑取值。下发方式 = CSS 变量 `--dsh-one-density-*`（挂在 frame 容器上，靠继承到容器内所有内容），消费方写成 `var(--dsh-one-density-<项>, <官方原值>)`——观感语言（图标/颜色/圆角/字体族/动效）不属于密度档。 |
| **局域网访问（LAN access）** | 我们工程词 | 让同一局域网内的其它设备用带 token 的链接打开本机 dsh 网页的能力。dsh 出于安全只监听 127.0.0.1（上游明拒 `--host 0.0.0.0`），可达性由局域网转发器提供，并在 spawn 时用官方 `--trusted-host` 让网关的 Host 信任栏放行。 |
| **局域网转发器（lan forwarder）** | 我们工程词 | 扩展在 `<局域网地址>:<端口>` 上起的纯 TCP 透传（`src/server/lanForwarder.ts`），把局域网连接原样转给 `127.0.0.1:<同端口>` 的 dsh 网关。多窗口共用同一个地址与端口，先到者持有监听，后到者探测到有人监听即按「对端在转发」处理。 |
| **loopback 代理** | 我们工程词 | 扩展在 127.0.0.1 起的转发服务器，替 webview 把请求转给 dsh 网关并附带登录 cookie（鉴权在代理侧完成，页面不接触 cookie） |
| **插件整包过滤** | 我们工程词 | loopback 代理把整包按每个插件代码段的起始标记切开后，删掉 block list 中的插件段、再拼好转发给 webview——只发生在 dsh-one 自己的转发管道里，网关服务端零改动 |
| **block list** | 我们工程词 | 不进 VS Code 前端的官方插件清单。**新铁律下目标态是「不 block 框架插件」**（见上文铁律），现存条目待结构纠正后逐个复核；新增须注释理由 |
| **双前端** | 我们工程词 | 同一网关实例上，官方 dsh web 拿全量清单正常使用，dsh-one 前端自己过滤——不给 dsh 加 profile、不改服务端 |
| **浏览器验证** | 我们工程词 | 用 Playwright 开普通浏览器页面跑装配断言（快、自动化，是第一道验证）；harness 常驻 `test/assembly-lab/`（`npm run verify:lab`），不再放在各 worktree 的 `.dev-host/` 里 |
| **VS Code 验证** | 我们工程词 | 用 `dev-ui-test.sh` 起隔离 VS Code 窗口加载扩展实测（慢、是最终准绳）；口语所称「真窗」「实验室」一律改用这两个词 |

## CHANGELOG 写法

CHANGELOG 写法见 skill **`changelog-conventions`**（正本在 `.agents/skills/changelog-conventions/`）：面向用户结果、一条一句、不写函数名/行号/内部术语。

## 提交与 CI

- **提交标题不许带 `[skip ci]`**（发布、合并、功能提交一律不许）：它只属于上游监控那种纯回写提交（`scripts/dsh-upstream-watch/watch.mjs` 的徽章回写）。带上它，那次 push 的 CI 会被**整个静默跳过**——2026-09-22 发布 v2.0.3 的合并提交标题照抄了它，那个 commit 的 CI run 数是 0（`gh api …/actions/runs?head_sha=46a3fcded3a4…`），看着像「CI 没跑」而不是「CI 失败」。
- **判断范围是「这次推送里的每一条提交标题」，不只是最上面那条**：2026-09-23 又踩了一次——为写这条规矩而提交的那条标题里把这几个字写了进去，于是同批推送（含两个功能合并）的 CI 一起被跳过。**写这条规矩、或写任何提到它的文档时，提交标题里要把标记拆开写**（例如写成「skip-ci 标记」不加方括号），否则自己把自己跳掉。
- 排查「CI 好像没跑」时先查这个：`gh api "repos/<owner>/<repo>/actions/runs?head_sha=<完整 40 位 sha>"` 的 `total_count` 是 0（而不是失败），基本就是被跳过了。
- CI 的三平台矩阵（ubuntu / macos / windows）**推送到任何分支都跑**，开发分支可以推到 origin 拿平台读数。装 dsh 那一步的版本钉在 `.github/workflows/ci.yml` 的 `env.DSH_SMOKE_VERSION`，**别改回 `@next` 或浮动范围**（上游整批没发全时它们会 `notarget`）。细节见 `docs/development.md` 的「CI（GitHub Actions）」。

## backlog 维护

见 skill **`backlog-github-issues`**（正本在 `.agents/skills/backlog-github-issues/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：backlog 唯一事实源是 GitHub Issues——加条目 = 建 issue（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**认领后必须再 `gh issue view` 复核 assignee 是自己**；改状态 = 换 label + comment 留痕（`b:open` → `b:doing` → `b:done` → `b:closed`，合入测试有问题 `b:done` 退回 `b:open`）；引用统一用 `#N`；不要建任何手工索引表。
