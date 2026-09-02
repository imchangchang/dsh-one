# README 面向使用者：去除内部开发信息

记录于 2026-09-02。准备发布到 Marketplace 前，README（README.md / README.zh-CN.md）里混着面向开发者的内容，需要清理成使用者导向。

## 背景与现象

- 两个 README 均有整节「For developers / 开发者」：环境要求、常用命令、调试、架构（src/ 目录树、核心流程）、测试约定、发版步骤（含 publisher 占位符说明、vsce login/publish）、内部文档链接（docs/architecture.md 等）。
- 使用者章节里也有内部痕迹：工作原理一节含 POST `/api/host.describe`、`rpcId` 回显、`?dsh_embed=vscode` 预留参数、`--no-open` 版本要求等实现细节；快速开始提到 `npm run package` 装 .vsix；截图节是给维护者的 TODO 注释；兼容性节混入 rc 版本实现说明。

## 现状

- 发布主体是 README.md（Marketplace 展示用），README.zh-CN.md 与其同步。
- 截图尚未采集（assets/screenshots/ 为空）。

## 方案

- 删除两个 README 的「For developers / 开发者」整节。
- 工作原理保留 mermaid 图与四步总览，删实现细节（API 端点名、rpcId、embed 参数、rc 版本要求）。
- 快速开始改为「从 VS Code Marketplace 安装」（发布后），去掉 `npm run package` 手动装流程。
- 删除截图 TODO 注释段（或无截图则整节移除）。
- 兼容性/已知限制保留用户视角信息（端口、多窗口、Remote 未验证），删内部措辞。

## 涉及位置

- `README.md`
- `README.zh-CN.md`

## 变更记录

- 2026-09-02 记录 → open

- 2026-09-02 记录 → open
- 2026-09-02 认领 → doing

- 2026-09-02 开发完成，自测通过（typecheck/336 test/build），done 标记 7b1d3ff → done

- 2026-09-02 主线合入（e6daf73），复测通过（typecheck/336 test/build）→ closed
