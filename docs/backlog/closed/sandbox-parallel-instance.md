# 沙盒（test/sandbox）不支持并行实例：两个 session 同时做容器验证会互相干扰

记录于 2026-09-06。来源：开发 i18n 两件套（Sprint 1D）session 实测踩坑 + 本次核实代码。

## 背景与现象

worktree 并行开发模式下，多个开发 session 各自要跑沙盒验证（起容器 → 驱动 → 截图）。实测（i18n session）：
- 沙盒被另一个并行任务占用时只能干等释放（共享单实例，不能抢）。
- 中途发现容器里装的扩展不是自己 build 的版本——镜像 tag 被并行任务覆盖成旧扩展（修复不在），被迫改用私有镜像 + 私有容器（8082 端口）绕过。
- 靠「容器名错开 / 端口错开」手工绕，没沉淀进脚本，下次并行还会踩。

## 根因（已核实）

`test/sandbox/run-sandbox.sh` 的资源全是固定单一值：

- 镜像 tag 固定 `dsh-sandbox:latest`（:19）——两个 build 写同一 tag，后完成的覆盖先完成的；build 与 start 交错时 start 可能拿到别人的镜像。
- 容器名固定 `dsh-sandbox`（:20），`start` 幂等重创：同名容器先 `docker rm -f`（:174-177）——两个并行 start 互相删对方的容器。
- 端口固定 8080（:154、:188），mock 模式另固定 9009（:192）——容器名错开后端口仍会撞。
- 截图目录共享 `/tmp/dsh-sandbox-shots/`（verify-driver.mjs:25 默认），按 `<id>.png` 命名覆盖（:205）——并行跑驱动截图互相覆盖，ledger 记录的截图是对方的。
- BUILDX_CONFIG 固定 `/tmp/dsh-sandbox-buildx`（:138）——两个并行 build 写同一 buildx 目录。

README（:247）与 worktree-dev-flow SKILL 也只写了「共享单实例，先 status 确认空闲」，即设计上就没支持并行。

## 建议方案

给 `run-sandbox.sh` 加实例化参数 `--instance <slug>`，各实例资源全部按 slug 派生；不传时保持现状（默认实例，向后兼容）：

- 镜像 tag：`dsh-sandbox-<slug>:latest`（默认仍 `dsh-sandbox:latest`）
- 容器名：`dsh-sandbox-<slug>`（默认仍 `dsh-sandbox`）
- 端口：有 `--instance` 时 `--port` 必填（不派生默认值，避免撞）；mock 端点宿主端口加 `--mock-port`（默认 9009，有 instance 且未显式给时取 `--port+1` 并打印）
- BUILDX_CONFIG：`/tmp/dsh-sandbox-buildx-<slug>`（默认 `/tmp/dsh-sandbox-buildx`）
- 截图目录：README 约定 `/tmp/dsh-sandbox-shots-<slug>/`，驱动调用方用 `--out` 指定（verify-driver.mjs 已支持，无需改）
- README 加「并行实例」小节：两个 session 各用各的 slug/端口，互不干扰；`status`/`logs`/`stop`/`sh` 作用于当前实例

## 涉及代码位置

- `test/sandbox/run-sandbox.sh` — 全部资源名与子命令（build/start/stop/logs/status/sh）
- `test/sandbox/README.md` — 资源约定（镜像名/容器名/端口）、产物目录约定、任务测试报告小节
- verify-driver.mjs 无需改（--out 已参数化，截图目录由调用方指定）

- 2026-09-06 记录：i18n session 实测 + 代码核实，资源全固定（镜像 tag/容器名/端口/截图目录）→ open/。
- 2026-09-06 认领（open → doing，worktree: agent/sandbox-parallel-instance）：run-sandbox.sh 加 --instance 派生资源，README 加并行小节。

- 2026-09-06 开发完成（worktree: agent/sandbox-parallel-instance, commit 7494328+5c74484）→ done。自测：bash -n + 错误路径（--port 必填/非法 instance/端口相同）+ 双实例并行实测（a:8081/mock 8082、b:8083/mock 8084 并存互不删，连同并行 session 的 dc:8091 三方并存）；仓库自测 typecheck/386 test/build 全绿。实测还修了两处：docker inspect 裸名踩同名镜像（--type container）、bash 3.2 全角字符与变量名粘连（\${}）。无 UI 行为变化，沙盒报告不适用。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed
