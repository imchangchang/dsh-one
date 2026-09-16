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

**worktree 开发 session 只开发、不合入**：dev-finish（自测 + 生成测试报告 + done 标记）通过后即止，合入由主线 agent 跑 `dev-merge.sh`。**合入门禁 = 测试报告审查**：报告由 `test/sandbox/` 的 ledger + `report.mjs` 产出（新增功能项在前、现有功能回归在后，每项带期望/截图/通过或失败结论），人工审查通过再合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收。

**集成线**：默认 `main`。`#11` 系列（Preact 迁移 + 对齐官方 dsh web）已于 2026-09-10 归档关闭：改动整线保留在 `develop/dsh-web-alignment`（远端同名分支），**仅作参考代码，不再开发、不再合入**；该系列 issue（#2/#11/#29/#40-#58 中相关条目）已关闭，真实问题重新梳理顶层结构后另立新 issue。`scripts/dev-merge.sh` 的 `MERGE_TARGET=<分支>` 能力保留（默认 `main`），`check-i18n.sh` 的合并基点跟随目标分支。

**验证线 `develop/cordis-chat`**（2026-09-14 起）：对话区官方 cordis 组件装配的验证线（#60 v1 整壳嵌入验收失败退回 `b:open` 后另立），条目 = #63（spike）→ #64（goal 1：对话区官方组件装配、侧栏保持自研）→ #65（goal 2：特有功能插件化）→ #66（goal 3：通用组件上游化）。该线任务合入用 `MERGE_TARGET=develop/cordis-chat`；`main` 保持自研 vanilla 前端不动，发布仍从 `main`。

**本线用词铁律——不准造词**：下表术语是唯一标准说法，issue、comment、汇报、代码注释、文档、对话里一律用标准词，禁止自造缩略词或新词（反面教材：「剥段」→ 标准词「插件整包过滤」）。现有词表表达不了的概念，先用一句平实的话说全、再登记进本表；宁可多写几个字，不让读者猜。

**官方机制名词直接写英文原词（用户铁律，2026-09-16）**：官方已有的机制名词（`slot` / `shadow` / `seam` / `combo` / `shell` / `staticModules` 等）**标准写法就是英文原词**，不要硬译成中文——译名要么不准确、要么需要额外解释（反例：把 `seam` 译成「接缝」，读者无法从中文反推官方概念）。中文只在**首次出现处**用括号作一句平实解释；我方工程词（如 `hostCall`/`hostResult`、loopback 代理）同样优先用代码里真实的标识符，而不是另起比喻名。

**文档说人话**：写给谁看就按谁的常识写——完整句子、不用电报式省略（禁「编排：取清单 → 过滤 → 起代理」式写法）、术语第一次出现时用一句日常话解释（代码标识符除外，用 code 标记）、讲理由就用「因为…所以…」的日常逻辑。写完自己读一遍，凡是需要猜的地方都改成人话。

**官方机制优先，禁 hack（用户铁律）**：改官方组件的行为或呈现，必须按以下优先序选机制，禁止跳序走捷径——

1. **官方槽位机制**：槽位贡献（slots.inject 对既有槽位名）与遮蔽（shadow：同名单独注册 + 更低 priority，官方注册表原生支持）；
2. **官方服务 API**：cordis ctx 上各服务的公开方法（如 theme 服务的 register/setTheme、settingsSchema、locale 字典注册）；
3. **官方预留接缝**：`__DSH_TRANSPORT__`、`__DSH_BOOT__` 清单、种子表、dsh.client 插件声明格式、`__DSH_BOOT_READY__`；
4. **CSS / DOM 手段**：**仅当**上述机制经读官方源码确认不存在时可用，且必须注释写明：官方无对应机制的证据（在哪个文件查过）、所用类名/结构在官方版本变化下的稳定性风险。

动手前先读官方源码确认机制存在与否；每个改动在提交信息或注释里注明走的是第几层机制。反例（禁止）：DOM 遍历模拟点击、改官方产物字符串、把 localStorage 恢复键当协调通道、无依据的 CSS 哈希类名硬盖。

**优先与官方插件共存，不顶替其角色（用户铁律，2026-09-16 因事故确立）**：改框架级行为时，优先「**加载官方件 + 只遮蔽（shadow）要改的那一个槽位**」，让官方件提供的契约（服务、槽位注入、钩子）原样存活；**禁止**用 block list 整体移除官方框架插件再由自有插件顶替其角色——那等于接手一份隐式、不版本化的内部契约，官方内部演进（如 0.1.6 新增下发给槽位的钩子 `usePanelInfo`）会让替代品静默崩坏。仅当官方件与目标形态**不可调和**时才允许 block，且必须在注释里写明：试过哪些共存路径、为何不可调和、接手了它哪些契约、这些契约如何随版本核对（上游探针覆盖）。

**底座的契约完备性（用户铁律，同一事故）**：底座（我们的 shell 实现——VS Code 侧的页面运行时 + 传输 + 渲染覆盖；**「shell」是官方概念，指提供页面运行时与传输的那一层**，见词表）与底座之上的插件，责任必须分开——
- **底座**：负责提供官方框架插件（renderer / layout / sidebar 等）对其它插件承诺的全部契约（服务、槽位注入、钩子、启动接缝）。官方改**树本身怎么搭**时底座跟着跟进，这是可接受的成本。
- **底座之上的插件**（官方插件与我们自研的官方格式插件）：**不得因为底座缺契约而失效**；只有官方对该插件自身做破坏性变更时才允许失效。
- 因此底座优先「加载官方框架插件、让契约由官方代码提供 + 我们只覆盖渲染与传输」，而不是自己重写框架件的角色；并且验证集里**必须有底座契约完备性断言**（每棵树在真实网关上零 `slot entry crashed`、零缺失钩子/服务），让缺口在验证阶段暴露，而不是在用户日常使用中暴露。

**官方新增默认保留（用户铁律，2026-09-16）**：官方新版本带来的新插件与新功能，**默认保留**（按需声明它们要的槽位、在合理位置渲染），**不得因为「我们用不上」「体积大」「暂时有空转」而进入 block list**。只有**与我们的形态直接冲突**（例如官方外框、官方侧栏这类要占据同一视觉区域、与 VS Code 容器职责重叠的件）才允许处理，且必须在注释里写明冲突点；体积/流量问题优先用缓存与按需加载解决，不用裁剪功能解决。判断口径统一为：**保留官方给用户的能力，只收敛与 VS Code 容器冲突的呈现**。

**自有插件命名（用户铁律）**：dsh-one 自有 cordis 插件一律命名在 **`@dsh-one` 作用域**下，形式为 **`@dsh-one/xxxxx`**（如 `@dsh-one/vscode-shell`）——模块 id、bundle 目录名、清单 entry id、注释与文档引用全部一致；新增插件照此办理，不得使用其它作用域或裸名。

**插件状态按官方惯例存储（用户铁律，2026-09-16）**：我们所有插件的状态，一律按 dsh 官方插件的方式存放，不得依赖 VS Code 的存储机制——
- **用户可感知的持久状态**（回收站名单、分组定义、标签、置顶等）→ 由**宿主半插件**拥有，落在 dsh 自己的目录（`~/.dsh`）下，经官方 RPC 机制暴露给前端插件；不允许放进扩展的 `globalStorage` / `workspaceState` / 扩展自建状态文件。
- **纯视图态**（展开折叠、排序、当前选中）→ 走客户端存储，沿用官方客户端既有惯例与键名风格（如 `dsh.*` 系列 localStorage），不另起第二套。
- **VS Code API 的状态存储（`globalStorage` / `workspaceState` / Memento）仅允许用于 shell 自身基础设施**：dsh 进程管理、loopback 代理生命周期、面板布局等，且代码里必须标注「shell 关注点，非插件状态」。
理由：① 双端复用（官方 web 拿不到 VS Code 的存储）② 与官方语义一致（dsh 插件的状态就该在 dsh 里）③ 避免同一份数据出现两套存储而漂移。存量偏差见条目 #82。

| 标准词 | 来源 | 含义 |
| --- | --- | --- |
| **shell** | **官方原词** | 官方注释原话「拥有不同物理传输的 shell 在此提供实现」——指**提供页面运行时与传输的那一层宿主环境**。我们的底座就是我们的 shell 实现。**不要**用它指代官方的框架插件（此前误用过） |
| **框架插件** | 我们工程词（指代对象是官方的） | 官方负责「把插件装起来、给出槽位与契约」的那几件：WebBoot 运行时、`ui-renderer`、`ui-layout`、`ui-sidebar`、传输层（`connection`/`api-gateway` 等）。此前误称「官方 shell」 |
| **外框插件（frame plugin）** | 我们工程词（对应官方 `AppFrame`） | 我们渲染页面外框的插件（现 id `@dsh-one/vscode-shell`，该 id 为历史遗留）；在新铁律下它的角色收敛为「遮蔽 root 槽位 + VS Code 渲染适配」。此前误称「shell 插件」 |
| **slot**（槽位） | **官方原词** | 官方槽位系统的命名单元（如 `conversation.chat.node`）；注册条目按 priority 竞争上位。**标准写法用官方英文原词 `slot`**，中文「槽位」仅作解释；此前我自造的「座位」为非标准词，不再使用 |
| **shadow**（遮蔽） | **官方原词** | 同名 slot 再注册一个**更小优先号**的条目：官方条目仍在注册表、其服务与 slot 声明照常存活，但不再渲染（号最小者上位）。出处：官方注册表报错原文「register at a different priority to shadow it (lowest renders)」与 `registry.d.ts` 注释；spike #69 浏览器实测过。**标准写法用 `shadow`**，中文「遮蔽」仅作解释 |
| **seam** | **官方原词** | 官方给 shell 预留的扩展点：WebBoot `run(container, seams)` 的 seams 参数、`__DSH_TRANSPORT__`、`__DSH_BOOT__`、种子表等；官方注释原话「拥有不同物理传输的 shell 在此提供实现」。**无可用的中文译法，直接写 `seam`**（我此前自造的「接缝」「平台缝」均为非标准词，不再使用） |
| **宿主调用通道（hostCall/hostResult）** | 我们工程词 | 页面插件向扩展宿主请求能力（跑 git、读写文件、弹对话框等）的请求-应答通道，消息类型即 `hostCall`/`hostResult`；官方 web 侧由宿主半提供同类能力。此前我自造的「能力桥」为非标准词，不再使用 |
| **combo**（插件整包） | **官方原词** | 网关把全部前端插件的代码拼成一个大文件、一个网址一次性下发；网校对文件内容做校验，改名单重新申请会 404。**标准写法用 `combo`**，中文「插件整包」仅作解释 |
| **装配** | 我们工程词 | 用官方 dsh web 前端组件在我们的 shell 里组装出 VS Code 前端（代码在 `src/ui/assembly/`、`src/server/assemblyMirror.ts`） |
| **loopback 代理** | 我们工程词 | 扩展在 127.0.0.1 起的转发服务器，替 webview 把请求转给 dsh 网关并附带登录 cookie（鉴权在代理侧完成，页面不接触 cookie） |
| **插件整包过滤** | 我们工程词 | loopback 代理把整包按每个插件代码段的起始标记切开后，删掉 block list 中的插件段、再拼好转发给 webview——只发生在 dsh-one 自己的转发管道里，网关服务端零改动 |
| **block list** | 我们工程词 | 不进 VS Code 前端的官方插件清单。**新铁律下目标态是「不 block 框架插件」**（见上文铁律），现存条目待结构纠正后逐个复核；新增须注释理由 |
| **双前端** | 我们工程词 | 同一网关实例上，官方 dsh web 拿全量清单正常使用，dsh-one 前端自己过滤——不给 dsh 加 profile、不改服务端 |
| **浏览器验证** | 我们工程词 | 用 Playwright 开普通浏览器页面跑装配断言（快、自动化，是第一道验证） |
| **VS Code 验证** | 我们工程词 | 用 `dev-ui-test.sh` 起隔离 VS Code 窗口加载扩展实测（慢、是最终准绳）；口语所称「真窗」「实验室」一律改用这两个词 |

## CHANGELOG 写法

CHANGELOG 写法见 skill **`changelog-conventions`**（正本在 `.agents/skills/changelog-conventions/`）：面向用户结果、一条一句、不写函数名/行号/内部术语。

## backlog 维护

见 skill **`backlog-github-issues`**（正本在 `.agents/skills/backlog-github-issues/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：backlog 唯一事实源是 GitHub Issues——加条目 = 建 issue（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**认领后必须再 `gh issue view` 复核 assignee 是自己**；改状态 = 换 label + comment 留痕（`b:open` → `b:doing` → `b:done` → `b:closed`，合入测试有问题 `b:done` 退回 `b:open`）；引用统一用 `#N`；不要建任何手工索引表。
