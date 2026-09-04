# 附件存储生命周期：清理策略 + 扫描防抖 + 工作区候选安全

## 背景与现象

复制粘贴附件落盘 `<tmp>/dsh-one-attachments/<sessionId>/`，只增不删；注释声称"macOS 3 天自动清"实为误述（os.tmpdir() 的 /var/folders/.../T 不保证定期清理，Windows %TEMP% 也不保证）。另：
- @ 补全工作区候选前端扫描（cwd 顶层+一层子目录）无缓存、每次按键全量 readdir+stat，大工作区卡顿（已加 250ms 防抖，深层扫描仍可优化）
- fs.stat 跟随 symlink：指向工作区外的链接会被扫成候选、可能扫进巨树
- shouldFoldPastText 只判下界（>10 行或 >800 字符），2MB 上限已加；无更长生命周期策略

## 方案（已拍板，2026-09-04 讨论确认）

1. **清理：不做应用级清理，与 dsh 归档语义对齐（只标记不删，保留恢复能力）**。调研 dsh 归档（`workspace.archiveSession`，dsh-workspace）确认：归档只是把 sessionId 追加进持久化的 `archivedSessionIds`，纯元数据操作，不打包/不搬迁/不删除任何数据；dsh 自带附件（dsh-attachment-local，`DSH_HOME/attachments/v1`）内容寻址、只收图片、无 retention（官方注释称清理是未来的 retention policy，尚不存在）。dsh-one 跟随该语义：归档后数据一律保留，未来 dsh 推出恢复/清理机制时再跟随；tmp 附件增长受粘贴行为天然限制（量小），接受。**不**做 TTL 定期、**不**做归档/删除联动。产出：仅修正注释误述，不新增任何清理代码。
2. **扫描优化（参数定案）**：lstat 替代 stat 不跟随 symlink（链接条目直接跳过）；深度维持现状 1 层（cwd 顶层+一层子目录）；子目录数量上限 64；候选池按 cwd 缓存 + 目录 mtime 指纹失效（只 stat 已扫目录本身对比 mtime，目录内容增删才重扫；不用 fs.watch——跨平台递归不可靠、句柄难管）；query 过滤改为池上内存过滤；总数上限 200 与 webview 250ms 防抖均保留。
3. **注释修正**：`attachmentDir.ts` 与 `chatTab.ts`（stagePastedFiles 注释）两处「系统会自动清理 / system-pruned，不会无限增长」误述，改为「OS 临时目录不保证定期清理；与 dsh 归档语义一致，附件只增不删，归档保留恢复能力」。（随代码修改时一并处理，不单独立项）
4. **shouldFoldPastText 不变**：10 行/800 字符下界与 2MB 上限保持；折叠出的 pasted-N.txt 随 tmp 目录保留。

## 涉及代码位置

- `src/ui/attachmentDir.ts`（注释误述；attachmentDir/nextSequenceIndex 不动）
- `src/ui/chatTab.ts`（≈443 处 stagePastedFiles 注释误述；落盘逻辑不动）
- `src/ui/chatMessages.ts`（≈676 `workspaceFileCandidates`：lstat、子目录上限、候选池缓存与失效）
- `src/ui/chat/webview.ts`（≈1549 250ms 防抖，不变）
- `src/pure/composerAttachment.ts`（≈100 shouldFoldPastText，不变）
- `src/extension.ts`（≈203 归档命令，确认不做附件联动删除）

## 变更记录

- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-04 方案讨论拍板：清理不做应用级（跟随 dsh 归档只标记不删、保留恢复能力）；扫描优化参数定案（lstat 跳 symlink、深度 1、子目录上限 64、候选池缓存 + 目录 mtime 指纹失效、上限 200）；注释误述两处随代码修；shouldFoldPastText 不变 → open（未认领开发）
