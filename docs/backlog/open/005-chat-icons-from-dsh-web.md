# 对话框图标直接使用 dsh web 的图标

记录于 2026-08-31。

## 背景与现象

要求：对话框里出现的图标（消息操作栏的 copy/check/like/dislike/branch，以及头部 chip 的 chevron 等），都直接使用 dsh web 官方界面的图标，保持视觉一致，不要在 dsh-one 里各维护一套。

## 现状

现在 `src/ui/chat/icons.ts` 是**手工镜像** dsh web 的图标：文件头注释写明 "SVG icon paths mirrored from the dsh web UI (dsh-client-ui-primitives, 16px outline set)"。做法是把每个图标的 SVG path 字符串抄进 `IconDef`，再由 `webview.ts` 的 `iconSvg()` 现拼 SVG。问题：

- 两边各存一份，dsh web 改图标后 dsh-one 靠人肉同步，必然漂移。
- 镜像源头 `dsh-client-ui-primitives` 并没有作为可依赖的包导出：dsh web 前端（`@deepseek-ai/dsh-web-frontend`）只发 minified dist bundle，图标是内联的 SVG 组件（16x16/20x20 viewBox），没有稳定的可 import 导出。所以现在**无法直接 import**，只能拷贝 path。

另有几个是 dsh-one 本地扩展、dsh web 没有对应物的图标（`terminal`、`boxedMinus`、`boxedPlus`、`remove`），这些应保留在本地，不属本条目范围。

## 建议方案

1. 让 dsh web 侧把图标集做成可复用导出：把 `dsh-client-ui-primitives` 的图标（按名字 → SVG path / React 组件）作为一个包或稳定子路径导出，供扩展端依赖。
2. dsh-one 把 `package.json` 依赖指向该包，`icons.ts` 里的镜像条目改为从包按名取，删掉手抄的 path；`webview.ts` 的 `iconSvg()` 消费路径不变。
3. 本地扩展图标仍留在 dsh-one（可继续用 `IconDef` 结构，或在 webview 里单独维护）。

## 涉及代码位置

- dsh-one：`src/ui/chat/icons.ts`（镜像的 SVG path）、`src/ui/chat/webview.ts`（`iconSvg()` 及 `MESSAGE_ACTION_ICONS` / `PANEL_ICONS` 消费点）。
- dsh web 侧：`dsh-client-ui-primitives`（图标源头，源码包）；发布产物见 `@deepseek-ai/dsh-web-frontend` dist bundle（当前只发 minified，无导出）。
