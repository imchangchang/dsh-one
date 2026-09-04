# 沙盒测试 docker build 触发 DSH 提权

## 背景与现象

主线跑沙盒测试（`test/sandbox/run-sandbox.sh build`，docker build）时，DSH 文件沙盒（workspace-write 模式）拦掉
buildx 对 `~/.docker` 的写入，命令失败，每次都要带 `sandbox_permissions` 提权重试（用户要手动批准，烦）。

实测报错：

```
ERROR: failed to build: failed to update builder last activity time:
open /Users/cgeng/.docker/buildx/activity/.tmp-orbstack381403458: operation not permitted
```

## 根因

`docker build` 默认走 buildx，buildx 会把 builder 元数据（activity 记录等）写到
`$DOCKER_CONFIG/buildx/`（默认 `~/.docker/buildx/`），在 session workspace 之外，属于沙盒保护范围，
`workspace-write` 模式下写被拒 → 提权提示。

## 建议方案

`run-sandbox.sh build` 内置 `export BUILDX_CONFIG="${BUILDX_CONFIG:-/tmp/dsh-sandbox-buildx}"`，
把 buildx 元数据目录重定向到 /tmp（平台临时区可写），不再碰 `~/.docker`。已验证：设置后构建全程无提权。
保留用户显式覆盖；README 加一句说明。

## 涉及代码位置

- `test/sandbox/run-sandbox.sh`（build 子命令）
- `test/sandbox/README.md`（build 小节说明）

## 变更记录

- 2026-09-04 建条目：复现 buildx 写 ~/.docker 被拦，提出 BUILDX_CONFIG 重定向方案，已实测有效。

- 2026-09-04 开发完成：run-sandbox.sh build 内置 BUILDX_CONFIG=/tmp/dsh-sandbox-buildx，实测无提权构建成功；dev-finish 通过（typecheck/test 386/build）。无 UI 行为变化，沙盒报告不适用。
