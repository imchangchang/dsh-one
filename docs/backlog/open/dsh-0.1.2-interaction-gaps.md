# dsh 0.1.2-rc.1 交互层对照：自研面板缺口清单

调研于 2026-09-08。0.1.2-rc.1（2026-09-03 发布）host/协议层（token 鉴权、dot-method wire 映射、0.1.2 WS 传输层）已由 dsh-token-auth Sprint 2A 覆盖并收口；rc.1 相对 alpha.5 无代码变化（仅 release commit），协议面不再变。本条目只记录**交互/UI 层**对照 dsh web 0.1.2 官方实现后、dsh-one 自研 chat 面板缺失的能力。若需逐项排期请按条认领。

## 缺口（按价值排序）

1. **回合导航**：官方提供覆盖完整历史的回合导航，可预览并跳转尚未载入的轮次。dsh-one 只有滚动触发的「加载更早」（historyWindow），无显式回合跳转。
2. **子代理模型配置**：官方支持调用方（宿主）为子代理指定 provider / model / reasoning effort / max output，及为 Claude Code、Codex 配置模型。dsh-one 的 subagent 只有头部 chip 展示（标题 + 时间/token 摘要），无配置入口；host 端 RPC 也未暴露对应参数（默认值下子代理功能可用）。
3. **会话标题区活动定时计划**：官方会话标题区域显示运行中的定时计划（不同视口宽度可见）。dsh-one 头部 chips（子代理/后台任务/preset）无定时计划。
4. **模型目录搜索与筛选**：官方模型目录支持搜索和筛选。dsh-one 的模型菜单按 provider 分组逐项列出（renderModelMenuModels），无搜索框。
5. **会话流字号调节 / 内容宽度拖拽**：官方支持会话流字号调节（Markdown 表格随字号缩放）与正文宽度自适应/拖拽。dsh-one 消息流无字号设置、宽度不可调。
6. **回答末尾 token 用量展开明细**：官方回答末尾显示 token 用量与耗时，可展开查看精确用量与统计。dsh-one 已有单行消息级计时（message-turn-timing-metrics，`HH:MM · 用时 · 首 token · tok/s`），但无展开明细。

## 核对过非缺口（存证，防止重复调研）

- 消息级计时、满5条提问历史问答卡、流式代码块高亮、Tab 补全斜杠命令、排队发送/插话、mention 绑定保持、问题卡草稿保留、连接状态/断线重连、diff/工具文件链接、图片立即显示（data URL 缩略图）、i18n 中英本地化 —— 均已支持。
- 轨迹视图（Inspect 按钮依赖）与插件列表分组视图：iframe 官方 UI 有，自研面板有意省略（webview.ts 有注释），维持现状。
- 默认折叠过程内容/System prompt：折叠块体系已有（思考/工具输出/注入上下文/问题详情），默认策略与官方略有差异，不单独立项。
- 图片压缩策略、上下文压缩计入图片占用等：发生在 dsh 侧上传管道，dsh-one host 不做压缩，不涉及。

## 备注

- 全局 dsh 需升到 0.1.2-rc.1 做全流程实机回归（当前机器还是 0.1.1-rc.2 老协议）。npm `@next` 标签当前指向 0.1.2-rc.1，README 安装引导无需改。
- 0.1.3-alpha.1 已于 2026-09-04 发布（GitHub），npm 尚未上 `@next`，暂不跟进。

## 变更记录

- 2026-09-08 调研 0.1.2-rc.1 release notes，对照 dsh-one 代码后建条目 → open
