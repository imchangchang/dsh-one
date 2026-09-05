# dsh-disconnect-banner：给官方 web GUI 打断连提示插件（client-plugin）

前置：`dsh-client-plugin-disconnect-patch-spike`（spike 结论：可行，证据与风险见其「spike 结论」节）

关联：`upstream-web-chat-stream-silent-freeze`（治本在上游，本插件是上游修复前的自用补丁）

## 目标

官方 web GUI 在实例重启/断连后聊天流静默卡死且无提示。用 client-plugin 机制（不改上游代码）打一个全局横幅插件：**传输断开持续超阈值、或重连成功（connection/reset）后聊天可能停滞 → 顶部横幅提示 + 「刷新页面」按钮**。

## 形态（spike 给出的最小 PoC，可直接起步）

```
dsh-disconnect-banner/
├── package.json     # dsh.client: platform web + immediately + inject connection/renderer
└── lib/
    ├── index.js     # host 半边 noop（照 dsh-client-ui-layout/lib/index.js）
    └── client.js    # 手写 window.__ModuleLoader__.load 外壳，零构建
```

- `package.json`：`exports["./client"]` 指向 bundle；`dsh.client.inject: ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-renderer"]`
- `client.js` 三要素（完整骨架见 spike session「调研 client-plugin 断连补丁」最终回复）：
  1. 信号 1：`ctx.connection.state.subscribe` → connecting/disconnected 持续 >10s → 弹横幅
  2. 信号 2：`ctx.on("connection/reset", …)` → 弹「连接已重建，聊天内容可能已停滞」
  3. 挂载：`ctx.slots.register({ name: "shell.overlay", id: "disconnect-banner", order: 0 }, Banner)`（走 `ctx.effect`，卸载自动消失）

## 启用步骤（验证时按此走）

1. `dsh plugin --profile web add /绝对路径/dsh-disconnect-banner`
2. `~/.dsh/profiles/web/cordis.patch.yml` 追加 `- insert: [{id: disconnect-banner, name: "dsh-disconnect-banner"}]`（live 生效）
3. **刷新浏览器页面**（新 row 进 `__DSH_BOOT__` 必须重渲 index）
4. 验证：Network 里 `/plugins/??dsh-disconnect-banner/client.js&rev=…` 200；设置→插件清单 fiber active

## 验收场景

- 起实例开会话 → kill 实例 → 10s 内弹横幅 ✓
- respawn 实例 → connection/reset 触发 → 横幅提示「聊天可能已停滞」✓
- 点「刷新页面」→ 页面重载、会话内容完整 ✓
- 正常会话无误弹（若 reset 误报烦人，按 spike 建议加 `eventSource.revision` + `snapshot.running` 停滞判定降噪）

## 风险与边界

- 内部 seam，上游改版可能打破——跟着 dsh 升级走，坏了就修或等上游治本
- 插件包放哪：建议本仓库 `packages/dsh-disconnect-banner/`（随仓库走，worktree 开发）或独立小仓库，实施时定
- 不处理降噪优化可以先保守策略上线自用

## 变更记录

- 2026-09-05 spike 结论可行（用户确认「如果3有必要就做吧」→ spike 完成）→ 另立本实现条目（open/）
- 2026-09-05 用户决定（「后端的问题先不去处理」）：**暂缓**——官方 GUI 侧补丁随上游问题一并搁置；spike 结论与 PoC 已存档（见前置条目 closed 区），重启时直接可用
