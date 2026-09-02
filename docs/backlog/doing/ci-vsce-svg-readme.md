# CI 失败：vsce package 拒绝 README 中的 SVG 横幅

记录于 2026-09-02。CI（.github/workflows/ci.yml）在 `npm run package`（= `vsce package`）步骤三平台全挂。

## 背景与现象

- 2026-09-02 README 重写（`4b7202a`、`79d44f7`）在 README.md / README.zh-CN.md 第 2 行加了 `<img src="assets/hero.svg">` 头部横幅。
- 此后 main 上 CI 连续失败（8e099c8 起 6 个 run），三平台同一错误：
  `SVGs are restricted in README.md; please use other file image formats, such as PNG: .../assets/hero.svg`
- 最后成功 run：`2da6070`（2026-09-01，README 尚未引用 hero.svg）。

## 根因

`vsce package` 硬性规则：VS Code Marketplace 不支持 SVG，README 引用 .svg 图片直接报错。typecheck / test / build / spawn 冒烟均不受影响，仅 package 步骤被拦。非代码问题，纯文档改动引入。

## 建议方案

- `assets/hero.svg` 光栅化为 PNG（1200×300，Chrome headless 渲染），README 两处引用改指 `assets/hero.png`，横幅视觉不变。
- 用户已确认方案（2026-09-02）：转 PNG 保留横幅。

## 涉及位置

- `assets/hero.svg`（→ 新增 `assets/hero.png`）
- `README.md`（第 2 行 img src）
- `README.zh-CN.md`（第 2 行 img src）

## 变更记录

- 2026-09-02 核实并记录 → open

- 2026-09-02 认领 → doing
