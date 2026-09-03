# README 补充内置安装脚本说明

记录于 2026-09-03。install/ 下已有一键安装脚本（dsh-install.sh / dsh-install.ps1，另有 uninstall），面板空态也会给一键命令，但 README 的快速开始只写了手动 npm 安装。

## 建议方案

README.md / README.zh-CN.md 的「快速开始」一节补一段：未装 dsh 时侧边栏给一键安装命令（社区脚本，dsh-one 维护），行为 = 复用兼容 Node（≥22.19 / ≥24）或下载官方便携 Node，无需管理员，装官方 @deepseek-ai/dsh 包；保留手动 npm 安装作为自选路径。

## 涉及位置

- README.md、README.zh-CN.md（Quick start / 快速开始）
- 2026-09-03 认领（open → doing）
- 2026-09-03 开发完成，自测通过，打 done/readme-install-script（doing → done）
