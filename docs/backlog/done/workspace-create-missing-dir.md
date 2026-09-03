# 创建新 workspace 报 workspace-invalid-path：目标目录从未被创建

记录于 2026-09-03。用户 Windows 上报 `Failed to create workspace: workspace.create failed: workspace-invalid-path cannot create a workspace at "C:\Users\imcha\.dsh\workspaces\tset": ENOENT: no such file or directory, realpath '...'`。

## 现象

插件标题区「+」→「创建 workspace」输入名字后必失败（报错如上），任意平台、任意名字都复现；「添加已有文件夹…」不受影响（选的是真实存在的目录）。

## 根因（已核实 dsh 0.1.1-rc.2 源码 + 本地网关实测）

1. **插件从不建目录**：`dshOne.workspace.create`（`src/extension.ts:332-371`）只检查 `~/.dsh` 存在，输入名字后直接把还不存在的 `~/.dsh/workspaces/<name>` 交给 `ensureWorkspace`（`src/server/dshRpc.ts:211` → RPC `workspace.create`），中间没有任何 `mkdir`。注释声称「make a folder under the dsh global directory」，`docs/architecture.md` 也写「建目录后经 ensureWorkspace 注册」，实现与描述不符。
2. **host 侧语义是「认领已存在目录」**：`dsh-workspace` 的 `registry.create`（`@deepseek-ai/dsh-workspace/lib/index.js`）先 `fs.realpath` canonicalize —— 路径不存在直接抛 Node 原生 ENOENT（JSDoc 明说 "a nonexistent path rejects with the original error"），不做创建。
3. **错误被包层**：host apiproxy 的 `workspace.create` handler（`dsh-host-apiproxy/lib/index.js`）把任何异常包成 `workspace-invalid-path`，消息 `cannot create a workspace at "<path>": <原错误>`；插件 `callRpc` 再拼成 `workspace.create failed: <code> <message>`（`dshRpc.ts:63`），即用户看到的全文。
4. **平台无关**：用不存在的路径对本机网关（127.0.0.1:3080）实测 `workspace.create`，返回与用户截图完全一致的 `workspace-invalid-path` + ENOENT。不是 Windows 特有路径问题。
5. **官方前端只认领不新建**：官方 `dsh-client-ui-workspace` 只有 `adoptDirectory`（系统选择器挑已存在目录），「输入名字凭空新建」是插件自创入口，漏了建目录这一步。

## 建议方案

调用 `ensureWorkspace` 前先 `await fs.mkdir(dir, { recursive: true })`（`extension.ts` 已 import node:fs 的 `fs.access`，加 mkdir 即可；recursive 一并兜住 `~/.dsh/workspaces` 本身不存在的情况——现状只检查 `~/.dsh`）。失败时沿用现有 catch 报错即可。

## 涉及代码位置

- `src/extension.ts:332-371`（`dshOne.workspace.create`：补 mkdir）
- `docs/architecture.md`（若实现修正，描述与实现即一致，无需改）

## 变更记录

- 2026-09-03 用户报 Windows 创建 workspace 失败 → 核实：dsh 0.1.1-rc.2 源码（dsh-workspace registry.create realpath 语义、host apiproxy 错误包装）+ 本机网关实测复现 → 根因是插件 `dshOne.workspace.create` 未建目录，非 Windows 特有 → 记录进 open/（未开始修改）。

- 2026-09-03 认领 → doing，worktree: agent/workspace-create-missing-dir

- 2026-09-03 开发完成（agent/workspace-create-missing-dir @ 7d5efdc：注册前 mkdir，typecheck/test 337 通过 + 真实网关端到端验证，dev-finish 自测通过）→ done
