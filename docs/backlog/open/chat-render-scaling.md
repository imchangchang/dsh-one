# 聊天渲染扩展性：缩略图请求风暴 + 虚拟化 + undo 栈

## 背景与现象

评审确认（P2，非阻塞）：
- 消息列表全量渲染（无虚拟化）：含几十/上百张图片文件的大会话初始渲染瞬间打 N 个 requestFileThumb，webview↔宿主通信风暴（fileThumbRequested 只拦重复不拦首发，已加失败重试）
- composer 输入框透明文字+高亮层方案固有代价：undo 栈被手改 value 破坏（删除 token 后 Ctrl+Z 不可恢复）；选中反馈已用 ::selection 底色缓解
- 气泡 hover 委托（mouseover 清+重设）在跨子元素时抖动

## 方案（已拍板 2026-09-04）

**四件全做**，不做裁剪：

1. 缩略图懒加载与可见区挂钩（IntersectionObserver）或请求批处理/节流
2. 消息列表虚拟化（render 只建可见窗口）——大语义改动
3. undo：评估 execCommand 或 contenteditable 迁移（透明文字方案的整体取舍）
4. 气泡 hover 缓存当前高亮 path（同 composer hoverTokenPath 模式）

**排期**：后置（Sprint 4 之后单独立项）。

**强制前置**：开发前必须**按当时代码现状重新核实所有问题**（本条内容基于 2026-09 评审时的代码；webview.ts 持续改动，届时行号/实现细节可能已变化，逐项复测后再开工）。

## 变更记录

- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-04 主 session 拍板：四件全做（含虚拟化与 undo 迁移，不裁剪）；排期后置；开发前按当时代码重新核实 → 条目更新（仍 open/）
