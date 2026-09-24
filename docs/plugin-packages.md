# 自有插件包：monorepo 结构、双端分发与官方 profile 安装（#73）

本文对应 dsh-one 2.0.0；文中的实测读数与「真机实测」一节是 2026-09-16 在 dsh
0.1.6-alpha.1 上跑出来的。

这篇文档回答三个问题：自有插件怎么打成**官方格式的 npm 包**、同一个包怎么在
VS Code 装配与官方 dsh web 两端都跑起来、以及怎么**实测**它真的在官方那边工作。

## 目标与结论（先看这一段）

- dsh-one 里**能移植的插件**（`@dsh-one/dsh-*`）现在同时是**可安装的官方插件包**：
  包住 `packages/<名>/`，用官方的 `dsh plugin --profile <profile> add file:<包目录的绝对路径>`
  就能把它装进任意 dsh 实例的 profile（包发布到 npm 之后，同一个命令直接写包名即可）。
- **一次安装双端生效**：包进 profile 后，官方 web 直接加载它；VS Code 侧装配清单本就从
  同一个网关取（过滤 block list 后叠加自有插件），所以网关那边有的插件，VS Code 侧
  也自然出现。
- 真机实测已经跑通（2026-09-16，0.1.6-alpha.1）：5 个自有插件包装进隔离 profile 后，
  官方 web 页面上全部加载并工作，零 pageerror、零 console error。跑法与逐条证据见
  `scripts/verify-plugins-official.mjs`（`npm run verify:plugins-official`）。

![官方 dsh web 页面上的自有插件](official-web-shots/plugin-packages.png)

上图是实测现场（**官方页面本身**，不是我们的装配页）：左侧栏是自有的工作区树（分组过滤
胶囊、搜索、工作区行与会话行都是自定义组件），会话头右侧是自有的「Session log」按钮
（官方同名图标条目已被 shadow，不在 DOM 里），对话区两轮来自仓库自带假模型的真回合。

## 官方是怎么找到并加载一个插件包的

这条链路每一环都是官方的机制，我们的包只要满足它的前置条件即可（不要自己发明通路）：

1. **`dsh plugin --profile <name> add <包>`** 把包转发给 profile 目录里的 pnpm。装完
   之后官方会**按装到的状态**重算层列表：装到的包只要在清单里声明了 `dsh.bundle.patch`，
   它的名字就被追加进 `~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.bundles`。
2. **启动时**，官方按「包层 → 用户层」的顺序把所有层叠起来（`dsh --dump-config` 可看）。
   我们那层只做一件事：`insert` 一行为本包，把包挂进 loader 树。
3. **挂进树的行**才有后续：官方 `@deepseek-ai/dsh-client-modules` 扫每一行的包清单，
   看到 `dsh.client`（且 `platform` 是 `"web"`）就把 `exports["./client"]` 指的那份
   bundle 并进 `window.__DSH_BOOT__` 的 wire 与 combo 段。
4. **浏览器侧**按 wire 取各段 bundle，逐条 `loader.create({ name: <包名> })`；包名既是
   loader 的行名，也是 combo 段的 id，所以 bundle 里自注册的 `id` **必须**等于包名
   （`test/pluginPackages.test.ts` 钉着这一条）。

由此得到包清单的硬要求（少一条就在官方侧静默不工作）：

| 字段 | 作用 | 缺了会怎样 |
| --- | --- | --- |
| `dsh.bundle.patch` | 让官方把包并进 profile 的层列表 | 包只是普通依赖，行不挂树，浏览器侧没有任何东西加载 |
| `dsh.client.platform: "web"` | 官方 client-modules 的筛选条件（源码逐字：`decl.platform !== "web"` 就跳过） | 扫到也当没有 |
| `dsh.client.inject` | 本包依赖的官方插件包（决定 combo 里的装载先后） | 依赖的官方插件晚到，槽位/服务可能还没就位 |
| `dsh.client.external` | bundle 里保持 `require()` 的模块（官方主 bundle 的种子表满足它们） | 打进包会双重实例化（两边各一份 `react`） |
| `exports["./client"]` | 浏览器侧 bundle 的落点 | 官方报「declares dsh.client but exports no "./client" bundle」 |
| `main` | 宿主半（官方 loader 的行模块） | 行 import 失败，fiber 起不来 |

## 仓库结构

```
packages/
  dsh-plugin-kit/          # 私有（private，不发布）：可移植插件共用的源码——宿主能力口
                           #   与挂载点，构建期打进各插件自己的 bundle（#94）
  dsh-host-capabilities/   # 宿主半：跑在 dsh 宿主进程里，经官方 Remote 暴露能力（#84）
  dsh-composer-clear/      # 自有插件包（每个 = 一个可装进 profile 的官方插件，
  dsh-context-menu/        #   包内就是该插件的全部源码）
  dsh-git-card/
  dsh-session-export/
  dsh-workspace-tree/
```

每个插件包的**源就在包内**（#94 起「一个包 = 完整插件」，包外没有第二份）：

```
packages/dsh-git-card/
  package.json        # 包清单：dsh.bundle + dsh.client + exports
  cordis.patch.yml    # 本包在 profile 里的那一层：只 insert 自己一行
  src/client.ts       # 浏览器侧入口 → re-export 同目录的插件本体（建包的 entry）
  src/gitCardPlugin.ts# 插件本体（其余几件分别是 composerClear / contextMenu /
                      #   sessionExport / workspaceTree 那几份；工作区树另有一个
                      #   src/workspaceTree/ 放行、工具栏、抽屉、样式等分件）
  src/index.ts        # 宿主半（本插件贡献全在浏览器侧，所以是空 apply）
  lib/                # 构建产物（不入库，由 `npm run build` 打出，见下面「构建」一节）
    client.js         #   官方 combo 格式的浏览器侧 bundle
    index.js          #   宿主半（ESM 单文件）
```

可移植插件要做的两件事——「在官方对话区容器上挂东西」与「向宿主请假」——各自的实现
只有一份，都放在私有包 `packages/dsh-plugin-kit/` 里：
`src/mountPoints.ts` 是挂载点（在官方对话区容器上挂东西——用它的有清空件、右键菜单、
提交卡三个），`src/hostCapabilities.ts` 是宿主能力口（向宿主请假——用它的有提交卡、
会话导出、工作区树三个），`src/hostClient.ts` 是能力口底下的宿主调用通道。
各插件按 `@dsh-one/dsh-plugin-kit/mountPoints` 这样的子路径取用，构建期由各插件自己的
bundle 各打一份进去。这个包 `private: true` 且不发 npm，所以对装包链路是零影响——
`lib/client.js` 依旧是自包含的。

发布的包只发产物（`files` 白名单只放 `lib/` 里的产物与补丁文件；`dsh-host-capabilities`
是纯宿主半，只有 `lib/index.js` 一个），源码不进 npm 包。

哪些件**不进** `packages/`：只能用在我们 shell 里的 `@dsh-one/vscode-*`（四棵树的
外框、主题跟随、会话选择桥、对话面板启动注入、设置齿轮）——它们要么渲染我们自己的外框，
要么调 VS Code 宿主，拿到官方 web 里跑没有意义。它们照旧直接打成
`dist/assembly/plugins/<id>/client.js`。

## 构建：一份产物，两端吃

`build.mjs` 扫 `packages/*`，读包清单决定怎么打（**清单是唯一事实源**，新增插件不必改
构建脚本）：

- `src/client.ts` → `lib/client.js`（官方 combo 格式，banner 里的 id = 包名），
  externals 取 `dsh.client.external`；
- `src/index.ts` → `lib/index.js`（宿主半，ESM）；
- 再把 `lib/client.js` **拷进** `dist/assembly/plugins/<包名>/client.js`——VS Code 侧
  loopback 代理伺服的还是这个路径，所以装配侧一行都没有改，两端吃的是同一份字节。

`@dsh-one/vscode-*` 那几件照旧在 `build.mjs` 里就地打成 `dist/assembly/plugins/`。

**产物不入库**（#106）：`packages/*/lib/` 与 `dist/` 都在 `.gitignore` 里，只为本地开发与
发布包存在。所以「装进 profile」之前先 `npm run build`——`file:` 安装会把包目录原样拷进
profile，`lib/client.js` 不在时包进了 profile 也不会加载（浏览器侧没有东西可取）。
`npm run verify:plugins-official` / `verify:clean-profile` / `verify:host-half` 这三条
npm script 都先挂了一条 `npm run build`；直接 `node scripts/verify-*.mjs` 跑的话，
脚本开头会检查产物在不在，缺了会指名要你跑 `npm run build`。

## 装进官方 profile 的步骤

```bash
# 装（本地包用 file:，发布后用包名）——`link:` 不会装依赖，别用
dsh plugin --profile web add file:/绝对路径/packages/dsh-git-card

# 看层列表与生效的树（确认包进了 dsh.profile.bundles、行挂上了树）
cat ~/.dsh/profiles/web/package.json
dsh --profile web --dump-config | grep -n dsh-one

# 起官方 web
dsh web --port 3399
```

在官方页面里应当看到：侧栏是自有的工作区树、会话头右侧是自有的「Session log」按钮、
消息里的行内码右键出自有菜单、提交号悬停出提交卡（数据来自宿主半）、空 composer 里
Esc ×2 出「再次按一次 Esc 清空」提示。

**隔离实测**时不要碰用户真实的 `~/.dsh` 与正在跑的实例：

```bash
HOME=$(mktemp -d) dsh plugin --profile web add file:$(pwd)/packages/dsh-git-card
HOME=... dsh web --host 127.0.0.1 --port 3399 --no-open
```

## 真机实测（这就是「它真的在官方那边工作」的证据）

```bash
npm run verify:plugins-official        # 全自动，约 2 分钟
node scripts/verify-plugins-official.mjs --keep   # 保留临时 HOME 与截图供人工看
```

脚本做的事，全部在**隔离的临时 HOME + 临时 profile + 现场取的空闲端口**里：

1. 起仓库自带的假模型端点（`test/mock-llm/`），临时 HOME 的 `settings.yaml` 指向它——
   真 dsh 走全部真实逻辑，只有模型响应是按固定场景回的，因此不需要任何真实凭据就能造出
   「含提交号的助手消息」与「含行内码的助手消息」。
2. `dsh plugin --profile web add file:...` 把 5 个插件包 + 宿主半装进临时 profile。
3. 起真 dsh web，用官方网关自己的 RPC 造一个工作区 + 会话（不打开任何系统对话框）。
4. Playwright 打开**官方页面本身**（不是我们的装配页），核对：每个包的 id 在
   `__DSH_BOOT__` 的行里、每个包的 combo 段被真的请求过、官方启动审计没有
   `Failed to load plugins`、页面零 pageerror / 零 console error。
5. 逐条跑端到端行为：清空件（Esc ×2 + Ctrl+Z 反悔）、工作区树（官方
   `sidebar.workspaces` 槽位里是自有树的行）、提交卡（悬停出卡，内容来自宿主半的
   `/api/dshOneHostCapabilities/gitShow`）、会话导出（自有按钮在官方会话头里，官方同
   id 条目被 shadow）、行内码右键菜单。

**读数口径（#241）**：每条断言一行 PASS/FAIL（详情一律压成单行），摘要行是
`全部通过（N 项断言）` 或 `失败 M 项（N 项断言）`，退出码 0 / 1。断言行数在通过的版本与
失败的版本上是同一份清单——所以读到 FAIL 是「这一处不工作」，不是「脚本坏了」。页面上的
元件先渲染出来、随后被卸载（自有件崩了，如 #236）时，读到它的那条记 FAIL、原因写进详情
（「卡片已被卸载，读不到内容」），后面几组断言照常跑完；万一某组里抛出没预料到的异常，
那一组记一条 FAIL，同样不带走别的组。只有「页面本身没起来」（composer 一直没进场）
才会整轮停下并报哪一步没等到。

它与另外两条验证线不互相替代：

| 线 | 验的是 | 跑法 |
| --- | --- | --- |
| **装配实验室** | **我们的装配页**（自有 shell + block list + 自有插件叠加）在真网关上装配得对不对 | `npm run verify:lab`（要换实验室服务器端口时用 `LAB_PORT=<空闲端口>`；缺省先试 3179，被占用就自动退到随机端口） |
| **官方 web 真机**（本文） | **官方页面**（官方全家桶 + 我们装进 profile 的包）加载与行为 | `npm run verify:plugins-official` |
| **VS Code 验证** | webview 宿主层（剪贴板 / 原生菜单 / 多 webview 生命周期；#188 查实宿主不会给扩展页面施加 CSP，见 `docs/architecture.md`），最终准绳 | `scripts/dev-ui-test.sh`（只由人跑） |

## 命名与归属

- `@dsh-one/dsh-*` = 官方 web 也能用（可移植）→ **必须有包**，且包名 = 装配清单里的
  插件 id（`src/ui/assembly/wireFilter.ts` 的常量），`test/pluginPackages.test.ts` 两边
  交叉核对。
- `@dsh-one/vscode-*` = 只能在 VS Code 侧用（渲染我们外框、调 VS Code 宿主、把设置开成
  编辑器页等）→ 不进 `packages/`，文件头写明为何不可移植。
- 补丁行的 `id` 用短横线名（`dsh-one-<名字>`），`name` 用包名；与
  `packages/dsh-host-capabilities` 的补丁同一口径。

## 还没做 / 已知边界

- **没发布到 npm。** 包按 `publishConfig.access: public` 备好了，本地用 `file:` 装的路径
  与发布后一致；首次 `npm publish` 与随后的 `dsh plugin add @dsh-one/...` 还没跑过。
- **装进 profile 的插件与 VS Code 侧叠加的自有插件是同名的两份**（网关那份 vs 扩展
  `dist/assembly/plugins/` 那份）。目前 VS Code 侧**不做去重**：#73 里写的「检测网关
  清单已含同 id → 跳过叠加」还没实现，两端各自的产出一致（同一份源码），所以表现为
  「谁是有效的那份取决于装配清单」，而不是行为分叉。
- **源内聚已做（#94）**：插件本体住在各自包内（`packages/<名>/src/`），包外没有第二份源；
  可移植插件共用的挂载点与宿主能力口收在私有包 `packages/dsh-plugin-kit/`（不发布，
  构建期打进各插件的 bundle）。仍留在 `src/ui/assembly/shell/` 的是只能用在我们 shell 里的
  `@dsh-one/vscode-*`（外框、主题跟随、会话选择桥、启动注入、设置齿轮）。
- **`src/pure/` 仍被插件包按相对路径引**（工作区树的推导、状态文件、词典等）：那是与扩展
  宿主、两个 webview 共用的纯逻辑层，不属于任何单个插件，所以没有跟着搬进包（#94 划的界）。
- **官方侧的体验差异**：`dsh-workspace-tree` 在官方 web 里会 shadow 官方侧栏树（那是
  这个插件的设计意图），`vscode-*` 那几件在官方侧不存在（渲染外框这类件本来就没有意义）。
- **多版本兼容**：真机实测只覆盖了本机装的 0.1.6-alpha.1；0.1.2 侧的官方 web 未实测。
