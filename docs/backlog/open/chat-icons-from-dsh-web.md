# 对话框图标直接使用 dsh web 的图标

记录于 2026-08-31。

## 背景与现象

要求：对话框里出现的图标（消息操作栏的 copy/check/like/dislike/branch，以及头部 chip 的 chevron 等），都直接使用 dsh web 官方界面的图标，保持视觉一致，不要在 dsh-one 里各维护一套。

## 现状

现在 `src/ui/chat/icons.ts` 是**手工镜像** dsh web 的图标：文件头注释写明 "SVG icon paths mirrored from the dsh web UI (dsh-client-ui-primitives, 16px outline set)"。做法是把每个图标的 SVG path 字符串抄进 `IconDef`，再由 `webview.ts` 的 `iconSvg()` 现拼 SVG。问题：两边各存一份，dsh web 改图标后 dsh-one 靠人肉同步，会漂移；且对话框里部分图标（如上下文注入 / Think 块）目前不是从 dsh web 拿的，视觉不一致。

另有几个是 dsh-one 本地扩展、dsh web 没有对应物的图标（`terminal`、`boxedMinus`、`boxedPlus`、`remove`），这些保留本地，不属本条目范围。

## 方案（已定）

不做包引用，直接从 dsh web 源码把图标拷过来用：找到 dsh web 里对应图标的 SVG path，更新 `src/ui/chat/icons.ts` 里的镜像条目（或补上缺失的），保证对话框里的图标和 dsh web 官方界面一致。dsh web 图标源头是 `dsh-client-ui-primitives` 组件集（本机 checkout 里没有该源码包，实际定义被打进 `@deepseek-ai/dsh-web-frontend` 的 dist bundle，需从 bundle 里反查 path 或找到原始源码）。

## 涉及代码位置

- dsh-one：`src/ui/chat/icons.ts`（镜像的 SVG path）、`src/ui/chat/webview.ts`（`iconSvg()` 及 `MESSAGE_ACTION_ICONS` / `PANEL_ICONS` 消费点）。
- dsh web 侧：`dsh-client-ui-primitives`（图标源头，源码包）；本机发布产物见 `@deepseek-ai/dsh-web-frontend` dist bundle（图标是内联 SVG 组件）。
