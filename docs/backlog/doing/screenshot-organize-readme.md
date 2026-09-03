# 整理截图目录并补 README 截图

记录于 2026-09-03。`docs/screenshot/` 下积了 17 张时间戳命名的截图（中英文混杂），README 中英文版目前只有 hero 图、没有功能截图。

## 现状

- 截图全部是 `20260903-HHMMSS.jpeg` 时间戳命名，看不出内容和语言。
- 覆盖的场景：dsh 未安装引导、服务启动中、新会话空态（hero）、首轮对话、ask_user_question 提问卡、plan review 卡、上下文用量弹层、权限请求卡、状态栏悬停卡、子代理树、会话右键菜单。
- 部分截图露出本机用户名路径（`C:\Users\imcha\...`），按宣发红线不能直接对外用。
- package.json 已配 `repository`，README 用相对路径引用截图可在市场页正常渲染。

## 建议方案

1. 截图按语言分 `en/`、`zh-CN/` 子目录，语义化 kebab-case 重命名。
2. 逐张评估是否达到对外（市场/README）标准；合格的加进 `README.md`（英文图）和 `README.zh-CN.md`（中文图）。
3. 在 `docs/screenshot/README.md` 建截图清单：现有图台账、市场可用性结论、已有图的问题、对照功能列表缺哪些截图。

## 涉及位置

- `docs/screenshot/`（重组）
- `README.md`、`README.zh-CN.md`（加 Screenshots 一节）
- 2026-09-03 认领，开始整理（open → doing）
- 2026-09-03 开发完成，自测通过（339 tests + build），打 done/screenshot-organize（doing → done）
- 2026-09-03 按反馈继续调整：README 只保留整窗口截图，路径暴露确认可接受（done → doing）
