# 多 VS Code 窗口无法收养 0.1.2 dsh（token 存单窗口 globalStorage）

## 背景与现象

用户（2026-09-06）实测：新开一个 VS Code 窗口（带 dsh-one 扩展）无法收养第一个窗口已启动的 dsh 实例。

## 根因（代码核实）

`dsh-owned.json`（pid + token）存 `context.globalStorageUri.fsPath`（manager.ts:537）——**per VS Code user-data，窗口隔离**：
- 同一窗口 reload：能拿到 token → re-own ✓（2A 已实测）；
- **第二窗口**：globalStorage 无该文件 → 「无 pidfile」分支 → probe 端口：
  - 0.1.1（无认证）→ probe === 'dsh' → adopted 复用 ✓；
  - **0.1.2（认证）**：probe 无凭证 → 401/404（probeAuthRequired 判定）→ 走「treating it as occupied」→ `findFreePort` **另起一个新 dsh 实例**（manager.ts:250-260）——不是收养而是资源重复/端口漂移，用户感知为「无法收养」。

即 2A 的已知坑（reload 场景已解）的**第二窗口形态**未覆盖。

## 方案（方向，含一个拍板点）

1. **共享身份记录**：`dsh-owned.json` 迁移到**全窗口共享位置**（如 `~/.dsh/dsh-owned.json` 或 dsh 配置目录下——与 dsh home 同域，跟随 dsh 安装/升级；或平台标识符目录），所有 VS Code 窗口可读 token/pid。旧 globalStorage 位置一次性迁移（读旧写新删旧，防陈旧态）。
2. **第二窗口语义（拍板点）**：推荐**认证式 adopted**——第二窗口读到共享记录 → 用 token 认证 probe 成功 → 以 `adopted: true` 复用（**绝不 kill**，与现有 adopted 语义一致），owned（停止/重启权）保持由第一个 spawn 窗口持有。不做「双 owner」或「第二窗口也持有 kill 权」（两个窗口互相停对方实例的竞态，无用且危险）。
3. **并发写**：共享文件写入用原子写 + 锁（与 main-lock 类似的文件锁或 os 原子 rename），防两个窗口同时 spawn 时互相覆盖/竞态；probe 幂等。
4. 0.1.1：路径不变（无认证 probe 即 adopted）。

## 验收

- 双窗口实测：窗口 1 spawn（0.1.2）→ 窗口 2（不同 user-data 或正常第二窗口）启动扩展 → 状态栏 Running 复用同一实例（同端口、不另起）、adopted 语义生效（不 kill）；窗口 1 停止服务时窗口 2 状态同步（stale 处理如实即可）。
- 窗口间竞态（同时启动）不产生双实例。
- 0.1.1 双窗口回归（adopted 复用不变）。

## 涉及代码位置（初判）

- `src/server/manager.ts`（owned 路径 537 / re-own 212-222 / adopted 240-250 / clearOwned）
- `src/server/serverAuth.ts`（probeToken/probeAuthRequired 复用）
- 新：共享记录读写 helper（原子写 + 锁）

## 变更记录

- 2026-09-06 用户实测反馈（第二窗口无法收养）→ 代码核实（token 存单窗口 globalStorage；0.1.2 认证实例被判 occupied 换端口另起）→ 建条目（open/）

- 2026-09-05 开发 session 认领（open → doing，worktree: agent/multi-window-adopt-012）。
- 2026-09-05 开发完成（doing → done，worktree: agent/multi-window-adopt-012）：共享记录迁移到 ~/.dsh/dsh-owned.json（原子写 + mkdir 锁，旧 globalStorage 一次性迁移）；第二窗口读到记录 → probeToken 认证 → adopted:true 复用（不 kill，owner=第一窗口保持 kill 权）；0.1.1 无 token 路径不变。自动化覆盖 = 12 项新单测 + 本机 0.1.2-rc.1 真环境探针 + 全量 529 pass；真双窗口场景建议人工开窗验收（命令见交接说明，报告 test/sandbox/verify.multi-window-adopt-012.report.html）。
