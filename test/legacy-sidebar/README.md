# 旧侧栏 × 现装配侧栏「并排渲染对照」harness（#129）

本目录把**退役但仍在仓库里**的旧侧栏独立渲染出来，与**现装配侧栏**在**同一份数据、同一
宽度**下并排截图、逐项量几何。产出（结论与几何表）在
`docs/legacy-vs-current-sidebar-render.md`；与 #128 那份**源码级**对照的分工是：那边读代码，
这边看渲染。

## 跑法

```bash
npm run verify:legacy-sidebar
```

一条命令，约 3 分钟。它自己完成四件事：

1. `npm run build`（页面要用 `dist/sessionsWebview.js`）；
2. 起一个**隔离的** `dsh web --host 127.0.0.1 --port 0 --no-open`（读它打出的那行 URL 取
   launch token），**跑完立刻 SIGTERM 收掉**；不写 `~/.dsh/dsh-owned.json`；
3. 起装配实验室（`test/assembly-lab/labServer.ts`，端口取随机）+ 一个只伺服旧侧栏那一页的
   小服务器（端口也随机）；
4. Playwright 跑 9 个状态 × 3 档宽度，两侧各截一张 + 拼一张并排图，并逐项读几何。

环境变量：

| 变量 | 作用 |
| --- | --- |
| `LEGACY_GATEWAY` | 复用已有网关（**必须**同时给 `LEGACY_TOKEN`）；不给就自己起 |
| `LEGACY_TOKEN` | 复用网关时的 launch token |
| `LEGACY_GATEWAY_PORT` | 自己起网关时用的端口，缺省 `0`（由系统挑一个空闲端口） |
| `LEGACY_LAB_PORT` | 装配实验室端口，缺省 `0` |
| `LEGACY_HEADED=1` | 开有界面的浏览器（跑完不退，人点页面用） |

前置条件与装配实验室一致：`npx playwright install chromium`（`npm ci` 正常装依赖时已带）。
**不需要**用户日常那个 VS Code 扩展在跑。

## 产物（都已 gitignore，随时可重跑）

- `out/verify.legacy-sidebar.ledger.json`——台账：全部断言、观测值、65 项几何的三档读数；
- `out/shots/legacy-<状态>-<宽度>.png` / `current-<状态>-<宽度>.png`——两侧各自的截图；
- `out/shots/pair-<状态>-<宽度>.png`——**并排图**（左旧右现，同一宽度、1:1）。

文档里引用的那几张并排图另归档在 `docs/legacy-vs-current-sidebar-shots/`（仓库惯例：
`docs/screenshot/` 也是入库的）。

## 两侧各自怎么拿到页面（都不抄模板，用的都是仓库里的真代码）

| | 旧侧栏 | 现装配侧栏 |
| --- | --- | --- |
| 页面来源 | `src/ui/sessionsView.ts` 的 `SessionsViewProvider.resolveWebviewView()`（真宿主代码），打桩 `vscode` 模块 | `test/assembly-lab/` 的真装配页（`/sidebar` 那棵树，`@dsh-one/dsh-workspace-tree` 以 shadow 顶掉官方浏览区） |
| 打桩的东西 | ① `vscode` 模块（`vscodeStub.mjs`：`Uri.joinPath` 让译文读真文件、`env.language`、`commands` / `window` / `l10n` 一律空实现）；② `vscode.Webview`（`asWebviewUri` 把 `dist/sessionsWebview.js` 映到本 harness 的服务器、`onDidReceiveMessage` 收下页面消息后**丢掉**）；③ `SessionsStore`（`snapshot()` 返回注入的快照） | 实验室那套：假宿主（`fakeHost.ts`）+ 真网关 + 真 mirror |
| 数据怎么进去 | `postMessage({type:'sessions', snapshot})`（旧侧栏本来就是宿主推快照的形态） | 假宿主的 `stateRead` 键值（`pinned` / `unread` / `tags` / `recycle-bin`，形状与 `~/.dsh/dsh-one/<键>.json` 逐字同形）+ 官方客户端的 `localStorage` 视图态（`dsh.workspaceTree.view`） |
| 译文 | 仓库真的 `l10n/bundle.l10n.zh-cn.json` 经 `loadWebviewL10n` 注入 | 官方 client 的中文词典 |

**基础主题**：旧侧栏只认 `--vscode-*` 变量，harness 在页面加载后贴一段 `theme.ts` 里的
VS Code 默认深色主题取值（出处见那个文件）；webview 的默认底色也照 VS Code 的行为补上。

**两侧的数据来自同一次只读读取**（`session/list` + `workspace/follow` 的基线帧），再各按自己
的原生通道喂进去——两侧「怎么读数据」本来就不同，硬塞同一棵 DOM 反而失真。

## 九个状态、两侧各怎么造

| 状态 | 旧侧栏 | 现装配侧 |
| --- | --- | --- |
| 默认态 | 快照 `collapsed: []`（全展开） | 视图态写「全部展开」 |
| 开箱默认 | 同上（旧侧栏开箱就是全展开） | **不动**（它开箱只展开当前会话那一组）——这一对故意不同，是 #128 C-1 的现场 |
| 折叠态 | 快照 `collapsed: [全部工作区]` | 视图态「全部展开」+ 点一次顶栏的折叠全部 |
| 多选态 | 会话行右键 → 「选择多个」→ 点组头勾选框 | 顶栏多选入口 + 组头勾选框（挑**第一枚能点**的：当天数据里当前工作区可能一条能勾的会话都没有、那枚框是灰的，写死「第一组」会让整轮 harness 在那里超时崩掉，见 #174） |
| 标签组态 | 快照 `tags`（挑非置顶会话最多的那棵工作区，两组成员） | 假宿主 `tags`（v2 形状） |
| 回收站抽屉 | 快照 `recycleBin`（每棵工作区各一条）+ 点底部入口行 | 假宿主 `recycle-bin` + 点入口行 |
| 空态 | 快照的工作区清单清空（会话还在 → 「未分组」桶） | 页内夹具把 `workspace/follow` 的清单改空 |
| 菜单一级 | 会话行右键 | 会话行右键 |
| 菜单二级 | 右击标签组块里的行 → 点「移到分组…」（就地展开） | 同左 |

**动作一律不实现**：旧侧栏发回宿主的消息只被丢掉（`legacyPage.ts` 里 `onDidReceiveMessage`
的注释写明），不落网关、不改状态；现装配侧的动作只落在假宿主里。跑前跑后各数一次会话条数
（`R-06` 同款守卫）——**红了多半不是本 harness 干的**：同一台机器上别的 session 在这几分钟里
建了会话就会让它红（#116 记的读数漂移）。

## 已知的取舍

- **旧侧栏的「当前工作区」判据**：真运行里 `sessionsStore` 把 `vscode.workspace.workspaceFolders[0]`
  的路径交给 `buildSessionTree`，harness 给的就是同一份（现装配侧假宿主上报的也是它），
  所以两侧的**判据输入一致**；判据是否同一条规则是源码问题，由 #128 覆盖。
- **标签组态会滚动到组块**：挑中的那棵工作区在列表里可能靠下，截图前两侧都把组块滚进视野，
  否则图上拍到的是别的行。
- **「行尾动作按钮」在悬停态下量**：两侧都要 hover 才出现，所以量它之前先把第一行会话
  悬停住（截图在那之前就拍完了）。
- **几何全部取同一时刻的实测值**：`getBoundingClientRect` / computed style，不看图。
  三档宽度下**没有一个几何项会变**（同一轮实测），说明差出来的都是密度与规格。
