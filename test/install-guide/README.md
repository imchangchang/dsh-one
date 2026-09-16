# 安装引导页的浏览器冒烟

这一组 harness 只验**安装引导 tab 那一页**（`src/ui/installGuide.ts` + `src/pure/installGuidePage.ts`，
#105 改版）。跑法：

```bash
npm run verify:install-guide                     # 英文基线，light + dark
SMOKE_LOCALE=zh-cn npm run verify:install-guide  # 用真中文译文渲染（串更长）
SMOKE_HEADED=1 npm run verify:install-guide      # 开有界面的浏览器看现场
```

## 为什么单独一组，不放进装配实验室

装配实验室（`test/assembly-lab/`）验的是**装配页**：四棵树在真实 dsh 网关上装得起来、槽位有内容。
安装引导页恰恰是「dsh 还没装」时给用户看的一页——它不参与装配树，网关起不来也要能显示，所以它
既不需要网关，也不需要实验室那套（假宿主 + 真实模块构建 + 上游 wire）。这一页的问题（下拉开不了、
命令没跟着平台换、复制没反馈、明暗主题下看不见）用一个普通浏览器页面就能全部测到。

## 它怎么渲染这一页

页面是宿主侧拼的 HTML，`src/ui/installGuide.ts` 顶部 `import * as vscode from 'vscode'`——真扩展
宿主里才有这个模块。所以：

- `vscodeLoader.mjs` 是一个 Node 解析钩子，把裸模块名 `vscode` 指到 `vscodeStub.mjs`
  （`register.mjs` 负责装上钩子，npm script 里用 `node --import` 带上）；
- `vscodeStub.mjs` 里的 `l10n.t` 与真宿主同语义：能取到译文就用译文，取不到就返回 key 本身。
  `SMOKE_LOCALE=zh-cn` 时读 `l10n/bundle.l10n.zh-cn.json`——中文串普遍更长，排版有没有被撑坏要看它；
- 于是冒烟脚本能直接 `installGuideHtml('macos')` 拿到**真实宿主代码产出**的页面（不是另抄一份
  文案），写进 `out/page.<locale>.html`，再用 `file://` 打开。

页面里的复制命令等动作走 `postMessage` 回宿主。浏览器里没有宿主，冒烟用页内假桥
`__DSH_ONE_VSCODE__`（#100 就给页面留了这条接缝：真 webview 里走 `acquireVsCodeApi`，冒烟里走这个
全局量）——假桥记下每条消息，并按真宿主的路径回一条 `installGuide:copied`，于是「复制成功」与
「复制失败」两条反馈都能断言。

## 断言（每档主题各跑一遍，共 96 条）

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

## 产物（`out/`，已 gitignore）

- `verify.install-guide.ledger.json`：**合入门禁报告**用的台账（`test/sandbox/report.mjs` 的形状：
  每项一段「看到什么」的期望 + 相关截图 + 通过/失败）。渲染成单文件报告：

  ```bash
  node test/sandbox/report.mjs --ledger test/install-guide/out/verify.install-guide.ledger.json
  ```

- `smoke.<locale>.json`：逐条断言明细 + 观测值（对比度实测、背景色等），排障用；
- `<locale>-<theme>-terminal.png` / `-editor.png` / `-menu.png` / `-narrow.png`：明暗两态的截图，
  **留给人工看观感**（布局、留白、层级这类浏览器断言只能兜住底线，好不好看要人眼）。

退出码：全过 0，有断言失败 1。
