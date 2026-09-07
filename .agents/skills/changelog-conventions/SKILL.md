---
name: changelog-conventions
description: dsh-one CHANGELOG 的写法约定——面向终端用户，一句话讲清「做了什么、对用户有什么影响」，不写实现细节（函数名/符号/行号/内部术语）。当要写/改 CHANGELOG 条目、版本收口、review 发布条目时用。正式版发布收口时按此风格审查全部条目。
---

# CHANGELOG 写法约定

CHANGELOG 是给**用户**看的：用户只看「这个版本对我有什么影响」，不看你代码怎么改的。技术细节放 commit message 和 backlog issue，CHANGELOG 只留结果。

## 硬规则

1. **每条 = 一句用户话**：讲「做了什么 + 对用户的影响」，不解释实现。
2. **不写**：函数名/变量名/键名、文件路径与行号、内部术语（wire 协议、对账、签名、宿主、PTC 等只有维护者懂的词）、无说明的 slug/代号。
3. **结构**：`Added` / `Changed` / `Fixed` / `Removed` 分节；一条一行（信息多时允许一行内两句短句，不展开成段）。
4. **用户无感的技术活**（重构、死代码清理、内部优化）：不单列，合并为一句「内部优化」，或归 `Changed` 一句带过；纯内部改动也可以直接不写。
5. **版本收口**：正式版把 `[Unreleased]` 收口成版本号；`-rc.N` 预发布**不消费** CHANGELOG（`[Unreleased]` 保留）。
6. 每条开头放一句**可检索的短关键词**（输入框、会话列表、侧栏、快捷键、兼容性……），方便用户扫读。

## 正例 / 反例

反例（技术味重，来自历史条目）：
> 插话快捷键占位符按平台区分文案（steer-shortcut-copy-per-platform）：会话运行中的 composer 占位符原来一律显示「⌘Enter 插话」，Windows/Linux 用户键盘上没有 ⌘ 键。现在附着会话的 ChatState 常态下发宿主平台（hostOs），macOS 保持 ⌘Enter，Windows/Linux 显示 Ctrl+Enter（按键处理本就 metaKey||ctrlKey 全平台可触发，纯文案修正）；hostOs 未知时回退 ⌘ 版原文案。

正例：
> 插话快捷键提示按平台显示：Windows/Linux 显示 Ctrl+Enter，不再一律显示 ⌘Enter。

再一组对照作者角度：函数签名、host 版本探测、wire 帧翻译在 CHANGELOG 里都不出现——用户只关心「换到 0.1.3 后聊天流式照常、斜杠命令照常」。

## 流程挂点

- **开发中**：改动涉及用户可见行为 → 更新 `CHANGELOG.md` 的 `[Unreleased]` 段（按本约定），随功能合入。
- **发版前**：收口时逐条复核，把技术味儿重的条目改写成用户话（release-gate 流程里审查 CHANGELOG）。
- **验收**：人工过一遍「每条是否问得出『用户看这句能知道什么』」，答不出就重写。

## 边界

- README / 用户文档（docs/）不受本约定约束（面向安装/排障，允许技术细节）；只约束 CHANGELOG.md。
- backcompat 破坏（升级后行为变化）必须在条目里一句话点明（用户需要知道）。
