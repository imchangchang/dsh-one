# chip chevron 打开态旋转 180°

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 下拉（preset chip / jobs chip）打开时 chevron 旋转 180°；dsh-one 的 popover 打开态不进渲染流水线，chevron 保持原样。

## 现状

popover 开态由事件/CSS 驱动，chip 的 chevron 不知道开合状态；要把状态回流到 chip 需要 popover 状态回流链路，改动面大于视觉收益。

## 建议方案

暂缓（此前已评估"代价大于收益"）。如果做：popover 开关时通知 chip 加 `open` 类，CSS 转 chevron。等有统一 popover 状态管理时顺带做。

## 涉及代码位置

- `src/ui/chat/webview.ts`（头部 chip 渲染、popover 开关逻辑）
