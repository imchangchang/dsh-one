# 外部启动的 dsh 实例完全接管（停止/重启/连接浏览）

## 背景

adopted-dsh-takeover 曾于 2026-09-02 拍板「先不做」（调研齐备：dsh 无 shutdown RPC、POSIX SIGTERM 优雅关闭可用、Windows 无优雅路径、不能复用 killOwned 进程组杀法、三平台 pid 探测方案已有）。2026-09-06 用户重开此需求，并要求**全做**（管理 + 连接浏览），三平台实现（用户有 Windows 机器可测，先确保 macOS）。

新认知（2026-09-06）：
1. **0.1.2 认证**：外部实例的 token 只在它启动 URL/stdout，扩展自动拿不到 → 认证连接（浏览会话）需要**用户粘贴 token**；
2. **停止/重启不需要 token**：kill 是 OS 操作（SIGTERM 优雅关闭）——识别「是 dsh」+ pid 探测即可管理；
3. 外部实例占 3080 恰好也是双实例风险源头（当前 fallback 另起）——本条目同时把默认行为改为「检测到认证 dsh 无法连接 → 报错不另起」。

## 需求（用户拍板：全做）

**A 档——停止/重启（不需 token）**：
- 识别规则：3080（或探测到端口的）上有认证 dsh（401+`unauthorized` 指纹，源码已核实）且非扩展 owned 记录（外部实例）→ 状态栏/tooltip 提供「Stop external instance / Restart Service」。
- 停止：**确认弹窗**（外部实例可能是用户终端进程、正在终端看日志）→ pid 探测（macOS `lsof -tiTCP:<port> -sTCP:LISTEN`；Linux /proc 扫描；Windows `netstat -ano` + tasklist）→ **只杀单 pid**（不能复用 killOwned 的进程组杀——外部实例进程组是 shell 的）→ POSIX SIGTERM（优雅，5s 兜底），Windows `taskkill /T /F`（无优雅路径，注明）。
- 重启：停止 + 扩展 spawn 新实例（新实例归扩展管理，后续免确认）。
- 确认身份降低误杀：杀前对照命令行含 `dsh` 特征（ps/tasklist）；理论竞态残留（与 owned pidfile 误杀窗同类，architecture 决策 1 已接受）。

**B 档——token 粘贴连接（浏览/操作会话）**：
- tooltip/通知：检测到外部认证 dsh →「粘贴终端启动 URL 的 token」入口（一键复制 URL 模板 + 输入框）；token 校验（GET /?token= 换票成功）→ 存共享记录（`~/.dsh/dsh-owned.json`，标 `external: true`，own=false）→ 扩展可认证连接（浏览会话/聊天照常）；
- 粘贴后权限：连接可用但**不触发 owned 语义**（不写 kill 权；停止走 A 档确认弹窗）。

**防护（并入）**：无 token 且判定为认证 dsh → **报错不另起**（tooltip 说明 + 管理入口）；非 dsh 占用留 fallback（用户已拍板）。

## 磁盘/端口语义

- 多窗口共享记录扩展字段：`source: 'spawn'|'external'`、`owned: true|false`（外部粘贴 token 后 external+owned=false）；re-own/迁移兼容旧记录。
- 防双实例：检测认证 dsh 无法连接先报错（本条目默认动作），外部实例管理经显式入口。

## 验收

- macOS 真机（用户机器）：终端 `dsh web` 起实例（0.1.2）→ 扩展检测为外部实例：默认报错不另起（防护 ✓）→ tooltip 提供停止/重启（确认弹窗、pid 单杀、优雅退出 ✓）→ 粘贴 token 后可连接浏览（✓）→ 重启后服务归扩展（后续免确认 ✓）。
- Windows：用户机器实测（停止/重启；`taskkill /T /F`；token 粘贴）——先 macOS 合入，Windows 实测结果补报告。
- 回归：0.1.1 外部实例（无认证）路径不变（adopted 复用）；spawn 管理实例不受影响；多窗口共享记录兼容。

## 变更记录

- 2026-09-06 用户拍板重开（全做：A+B+三平台；macOS 优先验证，Windows 有机器可测）；并入防护方案（401 指纹报错不另起，用户已拍板）→ 建条目（open/）
