# 装配实验室（浏览器验证 harness）

本目录是**常驻的浏览器验证套件**：用 Playwright 打开装配页跑断言，覆盖「装配页能不能
装起来、装得对不对」这一类问题。它在仓库里（而不是在某个 worktree 的 `.dev-host/` 里）
的原因是一条铁律——**验证集里必须有「底座契约完备性」断言**（见 `AGENTS.md`）：0.1.6 的
`usePanelInfo` 事故就是「底座漏了一条官方下发的契约、真运行里才炸」的典型，这类断言必须
每次改装配都能重跑，而不能随着 worktree 被删掉。

## 它验的是什么（和另外两条验证线的关系）

| 线 | 跑法 | 验什么 | 快慢 |
| --- | --- | --- | --- |
| **浏览器验证**（本目录） | `npm run verify:lab` | 装配页在**普通浏览器**里能不能装起来、槽位有没有内容、渲染/交互/外观对不对。页面用仓库真实模块构建，数据面是本机真实 dsh 网关（只读），宿主侧是假宿主 | ~50 秒，第一道 |
| **VS Code 验证** | `scripts/dev-ui-test.sh` | 真 VS Code webview 宿主层：CSP 差异、剪贴板、原生菜单、多 webview 生命周期。慢，是**最终准绳** | 分钟级 |
| **沙盒**（`test/sandbox/`） | `test/sandbox/run-sandbox.sh` | code-server 里装真插件 vsix 做宣发截图/人工核对 | 分钟级 |

三者不互相替代：本目录跑绿的改动仍可能需要 VS Code 验证（尤其碰宿主行为时），反之亦然。

## 跑法

```bash
npm run verify:lab                 # 全量：build + 五套件 + ledger + HTML 报告
npm run verify:lab -- --suite F-01 # 只跑契约完备性
npm run verify:lab -- --headed --keep   # 开有界面的浏览器，跑完留服务器，人工点页面
```

前置条件（两条）：

1. `npm run build` 过（`verify:lab` 自己会先跑）。自有插件的 bundle 在
   `dist/assembly/plugins/`，页面要靠它装配。
2. **本机有一个在跑的 dsh 网关**，端口缺省 3080，且它的 launch token 能从
   `~/.dsh/dsh-owned.json` 里读到（扩展 spawn/adopt 的实例都会记在那；手工起的实例用
   `LAB_TOKEN=<token> npm run verify:lab`）。网关**只读**——套件只做渲染与本地夹具交互，
   token 换票是唯一的写类动作（与扩展自身连接路径相同）。

环境变量：`LAB_GATEWAY`（网关地址）、`LAB_TOKEN`（token）、`LAB_PORT`（实验室端口，
缺省 3179，`0` = 随机）。全部参数见 `node test/assembly-lab/verify.ts --help`。

chromium 由 devDependency `playwright` 在 `npm ci` 时下载；如果没有（例如装依赖时跳过
了脚本），先跑一次 `npx playwright install chromium`。

**CI 里不跑这个套件**（它需要本机跑着一个真网关），它是开发/合入前的本机第一道验证。

产物（都已 gitignore，随时可重跑）：

- `test/assembly-lab/out/verify.lab.ledger.json`——台账（事实源，报告由它渲染）
- `test/assembly-lab/out/verify.lab.report.html`——单文件报告（截图 base64 内嵌，可直接分发）
- `test/assembly-lab/out/shots/*.png`——各套件截图

人工开窗：跑 `--headed --keep`，浏览器打开的 `/` 是实验室首页，列出四棵树的页面链接。

## 套件

| 套件 | 验什么 |
| --- | --- |
| **F-01 CONTRACT** | 底座契约完备性（铁律要求的那条）：四棵树各自**零 `slot entry crashed`**、零 `data-slot-error`、零 pageerror、零装载未激活（`web boot: … did not activate` / `waiting for service`，即缺服务/缺钩子）；关键座位有内容；该树的自有插件全在 combo 请求里且 frame 插件确实执行过 |
| **F-02 SMOKE** | 三棵树冒烟：侧栏出真会话行/分组行、对话区 composer 可输入且会话面板挂在 keyed `main` 槽位上、设置页出设置项，且控制台零 error |
| **F-03 INTERACT** | 关键交互：行内码右键菜单（官方 Menu 单图标项 + Esc 关闭 + 高亮撤销）、commit 卡片（走宿主能力桥 + GitHub 按钮发出 `vscode.openExternal`）、清空（Esc ×2）与反悔（Ctrl+Z） |
| **F-04 PARITY** | 侧栏自有树与官方浏览区在 260/340/500 三档宽度下逐项对齐：分节头、搜索胶囊、图标按钮、分组行、会话行、标题、时间、图标位、列表容器的 computed style 与几何矩形；**数值不硬编码**，两侧取到就直接比 |
| **F-05 BRIDGE** | 宿主能力桥页面侧：全页 `acquireVsCodeApi` 只调一次、并发调用按 id 配对、结构化错误带 code、上行消息形状 |
| **R-06 只读守卫** | 整轮跑前跑后数一遍网关会话数：必须一模一样。「真实网关只读」的可执行定义——喂 prompt、点新建会话都会改变这个数 |

首版 6 项合计 245 条断言，全绿约 50 秒。

## 页面是怎么造出来的（为什么可信）

`labServer.ts` 不用自己那份 HTML 模板，而是直接调生产模块：

- 装配页 HTML = `src/ui/assembly/pageHtml.ts`（与 VS Code webview 里同一个函数）；
- 清单过滤 = `src/ui/assembly/wireFilter.ts` + `src/ui/assembly/trees.ts`
  （三棵树的 block list / 自有插件 id，与生产**同一份定义**）；
- loopback 反代 = `src/server/assemblyMirror.ts`（与扩展里同一个 mirror 实例实现）；
- 页面其余请求（`/plugins-local/??…`、`/api/…`、`/assets/…`）原样转给 mirror，
  实验室不自己造资产管线。

所以「实验室验的就是生产装的」不是靠人工同步，而是同一份代码。

四棵树：`/chat`、`/sidebar`、`/sidebar-official`（对照档：同一 frame 不装自有树插件，
让官方浏览区渲染，供 PARITY 当基准）、`/settings`。

页内宿主是**假宿主**（`fakeHost.ts`，走 `addInitScript` 在页面任何脚本之前注入，对应
「VS Code 在 webview 里预置宿主对象」的真实位置）：`acquireVsCodeApi` 与 VS Code 同语义
（**全页只允许一次**，第二次 throw），`dshOne.hostCall` 按 `src/pure/hostCalls.ts` 的同一套
协议应答。

## 写新套件的约定

- 断言用 `Check`（`harness.ts`）：`check.ok/eq` 判定、`check.fact` 只记观测值。一条断言
  一处观测，失败信息里带上实测值。
- **崩溃与缺失契约永远不准进白名单**：`KNOWN_NOISE` 只放行与底座无关、且另有 issue 跟踪的
  官方插件噪音，每条必须写理由与 issue 号（现有 1 条 = #74）。
- 交互夹具（例如「消息正文里的 commit hash」）允许页内注入，但必须在套件的 `expect`/注释里
  说明为什么用夹具而不是真数据（真模型输出不可复现）。
- 只用**官方语义标记**选元素（slot 属性 `[data-slot=…]`、`role`、自有类名）；官方 CSS-module
  的哈希类名一律按**类名后缀**匹配（`_sessionRow`），不写死哈希前缀。
- 一次性诊断脚本不入库：跑完就删，或改造成可复跑的套件后再提交。

## 还没补的断言（按 ledger 规格盘点，逐条补）

以下条目在历史 ledger（`test/sandbox/verify.*.ledger.json`）里出现过，本目录尚未覆盖：

- **TREE/RENAME**：整包以自有插件 id 装载的三处同 id 断言（combo 请求 / CSS 标记 / 插件标记）
  与旧 id 无残留（现由 F-01 覆盖了 combo 请求与 CSS 标记两处，未查旧 id 残留）；
- **NOFLASH**：`?session=<id>` 注入会话时的防闪帧遮罩；
- **EXPORT**：会话日志导出自有行动（需要一份真实会话数据）；
- **PERF**：整包缓存命中与 git 卡片扫描开销；
- **PARITY 加深**：悬停态（时间隐去、操作按钮出现、分组行文件夹换箭头）与更多元素档位；
- **INTERACT 加深**：树的折叠/选中/搜索/视图选项（需要驱动侧栏树，会写网关的选中态，
  需要先确认只读边界）。
