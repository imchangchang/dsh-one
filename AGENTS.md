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

**文档说人话**：写给谁看就按谁的常识写——完整句子、不用电报式省略（禁「编排：取清单 → 过滤 → 起代理」式写法）、术语第一次出现时用一句日常话解释（代码标识符除外，用 code 标记）、讲理由就用「因为…所以…」的日常逻辑。写完自己读一遍，凡是需要猜的地方都改成人话。

**官方机制优先，禁 hack（用户铁律）**：改官方组件的行为或呈现，必须按以下优先序选机制，禁止跳序走捷径——

1. **官方槽位机制**：槽位贡献（slots.inject 对既有座位名）与影子替换（同名单独注册 + 更低 priority，官方注册表原生支持）；
2. **官方服务 API**：cordis ctx 上各服务的公开方法（如 theme 服务的 register/setTheme、settingsSchema、locale 字典注册）；
3. **官方预留接缝**：`__DSH_TRANSPORT__`、`__DSH_BOOT__` 清单、种子表、dsh.client 插件声明格式、`__DSH_BOOT_READY__`；
4. **CSS / DOM 手段**：**仅当**上述机制经读官方源码确认不存在时可用，且必须注释写明：官方无对应机制的证据（在哪个文件查过）、所用类名/结构在官方版本变化下的稳定性风险。

动手前先读官方源码确认机制存在与否；每个改动在提交信息或注释里注明走的是第几层机制。反例（禁止）：DOM 遍历模拟点击、改官方产物字符串、把 localStorage 恢复键当协调通道、无依据的 CSS 哈希类名硬盖。

| 标准词 | 含义 |
| --- | --- |
| **装配** | 用官方 dsh web 前端组件在自有 shell 里组装 VS Code 对话区（代码在 `src/ui/assembly/`、`src/server/assemblyMirror.ts`） |
| **loopback 代理** | 扩展在 127.0.0.1 起的转发服务器，替 webview 把请求转给 dsh 网关并附带登录 cookie（鉴权在代理侧完成，页面不接触 cookie） |
| **插件整包（combo）** | 网关把全部前端插件的代码拼成一个大文件、一个网址一次性下发；网校对文件内容做校验，改名单重新申请会 404 |
| **插件整包过滤** | loopback 代理把整包按每个插件代码段的起始标记切开后，删掉 block list 中的插件段、再拼好转发给 webview——只发生在 dsh-one 自己的转发管道里，网关服务端零改动 |
| **block list** | 不进 VS Code 前端的官方插件清单（当前 2 个：`dsh-client-ui-layout` 官方外框、`dsh-client-ui-sidebar` 官方侧栏；新增须注释理由） |
| **shell 插件** | `@dsh-one/vscode-shell`（自有），接管根外框、提供 layout 服务桩、负责主题着色（ThemePresenter 复刻）；没有它官方前端组件起不来 |
| **双前端** | 同一网关实例上，官方 dsh web 拿全量清单正常使用，dsh-one 前端自己过滤——不给 dsh 加 profile、不改服务端 |
| **浏览器验证** | 用 Playwright 开普通浏览器页面跑装配断言（快、自动化，是第一道验证） |
| **VS Code 验证** | 用 `dev-ui-test.sh` 起隔离 VS Code 窗口加载扩展实测（慢、是最终准绳）；此前口语所称「真窗」「实验室」一律改用这两个词 |

## CHANGELOG 写法

CHANGELOG 写法见 skill **`changelog-conventions`**（正本在 `.agents/skills/changelog-conventions/`）：面向用户结果、一条一句、不写函数名/行号/内部术语。

## backlog 维护

见 skill **`backlog-github-issues`**（正本在 `.agents/skills/backlog-github-issues/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：backlog 唯一事实源是 GitHub Issues——加条目 = 建 issue（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**认领后必须再 `gh issue view` 复核 assignee 是自己**；改状态 = 换 label + comment 留痕（`b:open` → `b:doing` → `b:done` → `b:closed`，合入测试有问题 `b:done` 退回 `b:open`）；引用统一用 `#N`；不要建任何手工索引表。
