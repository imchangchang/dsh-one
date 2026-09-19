# 宿主侧页面的浏览器冒烟

这一组 harness 验**宿主侧那两页**——它们都不参与装配树（dsh 没装时网关起不来，装配页组装不了，
只能由扩展宿主直接出 HTML）：

| 页 | 代码 | 来源 |
| --- | --- | --- |
| 安装引导 tab | `src/ui/installGuide.ts` + `src/pure/installGuidePage.ts` | #105 改版 |
| 状态页——侧栏与对话面板两种措辞共用一份 HTML（未安装 / 启动中 / 未运行 / 启动失败 / 装配失败） | `src/ui/sidebarStatusPage.ts` + `src/pure/sidebarStatus.ts` | #100 交付，#101 纳入本覆盖；`sidebarStatusHtml(view, { surface })` 的 `surface` 决定文案说「侧栏」还是「对话面板」 |

跑法：

```bash
npm run verify:install-guide                     # 英文基线，light + dark
SMOKE_LOCALE=zh-cn npm run verify:install-guide  # 用真中文译文渲染（串更长）
SMOKE_HEADED=1 npm run verify:install-guide      # 开有界面的浏览器看现场
```

命令名还是 `verify:install-guide`（#105 起的名字，文档与发布报告里都引它），覆盖范围以本页为准。

## 为什么单独一组，不放进装配实验室

装配实验室（`test/assembly-lab/`）验的是**装配页**：四棵树在真实 dsh 网关上装得起来、槽位有内容。
状态页恰恰是「dsh 还没装」或「服务没起来」时给用户看的——它不参与装配树，网关起不来也要能显示
（同一份页面也用在窗口重载后对话面板装不起来的时候，只是文案说「对话面板」），所以既不需要网关，
也不需要实验室那套（假宿主 + 真实模块构建 + 上游 wire）。这两页的问题（下拉开不了、命令没跟着
平台换、复制没反馈、状态页画错、明暗主题下看不见）用一个普通浏览器页面就能全部测到。

状态页**跟随服务状态变化**（#101）是宿主侧逻辑（订阅 `ServerManager.onDidChangeState`），不是页面
上的东西，本 harness 测不到——那部分在 `npm test` 的 `test/sidebarStatusPage.test.ts` 里
（重绘、退订、不重复订阅），两层合起来才是这两页的完整覆盖。

## 它怎么渲染这两页

页面是宿主侧拼的 HTML，两个入口模块顶部都 `import * as vscode from 'vscode'`——真扩展宿主里才有
这个模块。所以：

- `vscodeLoader.mjs` 是一个 Node 解析钩子，把裸模块名 `vscode` 指到 `vscodeStub.mjs`
  （`register.mjs` 负责装上钩子，npm script 里用 `node --import` 带上）；
- `vscodeStub.mjs` 里的 `l10n.t` 与真宿主同语义：能取到译文就用译文，取不到就返回 key 本身。
  `SMOKE_LOCALE=zh-cn` 时读 `l10n/bundle.l10n.zh-cn.json`——中文串普遍更长，排版有没有被撑坏要看它；
- 于是冒烟脚本能直接 `installGuideHtml('macos')`、`sidebarStatusHtml(view)` 拿到**真实宿主代码产出**
  的页面（不是另抄一份文案），写进 `out/`，再用 `file://` 打开。状态页那几态由真实分流判定产生
  （`decideSidebarStatus` / `assemblyFailureView` 的结果直接喂给页面），所以分流判定本身没变也一并被钉住。

页面里的动作（复制命令、启动服务、重试装配、开安装指南）走 `postMessage` 回宿主。浏览器里没有宿主，
冒烟用页内假桥 `__DSH_ONE_VSCODE__`（#100 就给这两页留了这条 seam：真 webview 里走
`acquireVsCodeApi`，冒烟里走这个全局量）——假桥记下每条消息，并按真宿主的路径回一条
`installGuide:copied`，于是「复制成功」与「复制失败」两条反馈都能断言，状态页的每个按钮也能断言
「点了发的是哪条消息」。

状态页自己不设背景色（真 webview 里那块底由宿主给），冒烟里补一条 VS Code webview 的默认样式
（`body { background-color: var(--vscode-editor-background) }`），页面才跟真 webview 里长得一样。

## 断言（每档主题各跑一遍，共 244 条）

安装引导页（IG-01…IG-09，共 98 条）：

| 面 | 断言 |
| --- | --- |
| hero | 大标题文案与字号（>=22px）、横向居中、有副标题、**没有**网站式顶部导航 |
| 安装一行 | 主按钮文案 + 下拉箭头、下拉初始收起、命令胶囊显示宿主平台的命令 |
| 命令胶囊 | 等宽字体、`nowrap` + `ellipsis`（单行省略） |
| 下拉 | 点开/收起、平台项与 `installPlatformItems()` 一致（macOS 与 Linux 命令相同 → 合成「macOS / Linux」一项）、只有一项带 ✓、未选中项留出 ✓ 的等宽空位、外链项带 ↗ |
| 选平台 | 命令即时换成该平台的、✓ 跟着移动且真的显示、选完收起并把焦点还给主按钮 |
| 关闭方式 | Esc 关闭并还焦点、点下拉外部关闭 |
| 复制 | 消息里**只有类型与平台名**（命令不搬进页面）、成功 → ✓ 态 + 朗读区报「已复制」、失败 → × 态 + 报「复制失败」、约 2 秒后回到空闲态 |
| 外链项 | 点它发出打开官方文档的动作，页面自己不开窗口 |
| 分段控件 | 默认「终端安装」段、两段互斥切换、步骤 3 条、「编辑器接入」段的入口发出打开 dsh web 的动作 |
| 主题 | 页面背景＝`--vscode-editor-background`、命令胶囊是与背景可分辨的一块面、六处文字按主题变量算出的对比度达标（正文 >=4.5:1，次要文字 >=3:1） |
| 窄面板 | 420px 宽时命令胶囊换到主按钮下一行、仍是单行、复制图标仍在胶囊内 |
| 干净度 | 控制台零 error |

侧栏状态页（SP-01…SP-07）：

| 态 | 断言 |
| --- | --- |
| 未安装 | 标题「dsh 尚未安装」+ 说明 + 「查看安装指南」按钮，按钮发 `assembly:openInstallGuide` |
| 启动中 | 说明「正在启动 dsh 服务…」+ 首次启动较慢的小字，**没有**按钮（再点一次没有意义） |
| 未运行 | 说明「dsh 服务没有运行…」+ 「启动 dsh 服务」按钮，按钮发 `assembly:start` |
| 启动失败 | 说明 + 「启动 dsh 服务」按钮 + 一段等宽详情块：错误文字原样显示，带 `<` `>` `&` 也当文本（不被当成标签、注入不生效） |
| 装配失败 | 说明里带失败原因 + 「重试」按钮，按钮发 `assembly:retry` |
| 对话面板恢复（SP-07，两态） | 窗口重载后恢复出来的对话面板装不起来时（服务没跑 / 装配失败）画的是同一份状态页，文案按面板说、按钮同上（`assembly:start` / `assembly:retry`） |
| 明暗两态 | 整页背景＝编辑器主题背景；说明/标题/小字/按钮文字与各自底色的明暗差达标（正文 >=4.5:1，小字 >=3:1） |
| 干净度 | 控制台零 error |

这七个状态 × 明暗两档共 142 条，加上 4 条分流断言（`decideSidebarStatus` 逐态对上）与安装引导页
那 98 条，一轮合计 244 条。

## 产物（`out/`，已 gitignore）

- `verify.install-guide.ledger.json`：**合入门禁报告**用的台账（`test/sandbox/report.mjs` 的形状：
  每项一段「看到什么」的期望 + 相关截图 + 通过/失败；安装引导页在前、状态页回归在后）。渲染成单文件报告：

  ```bash
  node test/sandbox/report.mjs --ledger test/install-guide/out/verify.install-guide.ledger.json
  ```

- `smoke.<locale>.json`：逐条断言明细 + 观测值（明暗差实测、背景色等），排障用；
- `<locale>-<theme>-terminal.png` / `-editor.png` / `-menu.png` / `-narrow.png`：引导页明暗两态的截图；
- `<locale>-<theme>-status-<态>.png`：状态页五态 × 明暗两态的截图。
  截图都**留给人工看观感**（布局、留白、层级这类浏览器断言只能兜住底线，好不好看要人眼）。

退出码：全过 0，有断言失败 1。
