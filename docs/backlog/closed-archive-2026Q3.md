# closed 条目归档（2026-09-07 迁移 GitHub Issues 前）

backlog 已迁移到 GitHub Issues（见本目录 README.md）。本文件是迁移前 docs/backlog/closed/ 下 182 个已完成条目的归档：每条保留标题、slug 和原「变更记录」。条目完整正文见 git 历史（删除前最后一个 commit）。

## 接管外部启动的 dsh 实例（可停止/重启）

slug: adopted-dsh-takeover

- 2026-09-02 用户提议接管外部实例 → 调研（dsh 0.1.1-rc.2 源码核实 shutdown 缺失、SIGTERM 优雅路径、进程组坑、平台 pid 探测）→ 用户拍板先不做，结论与依据记入 open/（未开始修改）。
- 2026-09-04 用户拍板「先不做」，调研资料归档（open → closed）

## adopted（另一窗口 spawn 的）实例提供确认式停止/重启入口

slug: adopted-manageable

- 2026-09-05 用户反馈（截图：外部实例无法重启）+ 确认 adopted 也应可管理（沟通澄清 B 档范围）→ 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree adopted-manageable）；实现如上；单测 567 全过、typecheck/build 全绿、i18n 门禁通过
- 2026-09-05 开发完成（doing -> done）：分支 agent/adopted-manageable；ledger test/sandbox/verify.adopted-manageable.ledger.json（5 项全过）；真机复验步骤（主窗口 spawn → 另一窗口管理）见条目覆盖说明。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（c1621e8）；ledger 5 项全过、审查通过；真机复验步骤见条目。

## Agent preset 选择器与 wire 协议两处失配

slug: agent-preset-roster-mismatch

- 2026-09-05 建档：调研 kimi-cli 复刻 preset 时核实定位，记入 open/。
- 2026-09-06 认领（worktree: agent/agent-preset-roster-mismatch）→ doing
- 2026-09-06 开发完成：wire 失配修复 + 单测/harness 场景 + 报告 4 项全 pass（done 标记 8dcfd52）→ done
- 2026-09-06 主线合入（merge 19185ef）＋复测通过（typecheck/test 620 pass/build）人工确认 → closed

## 附件文件框与图片框同尺寸（输入区 + 已发送消息）

slug: attachment-file-chip-uniform-size

- 2026-09-XX 记录 → open
- 2026-09-XX 认领（worktree: agent/attachment-file-chip-uniform-size）→ doing
- 2026-09-XX 开发完成，自测通过（typecheck + 317 test + build，commit 30d92dc）→ done
- 2026-09-XX AI 视觉验证（attachment-uniform 场景：输入区+消息区四框实测均 50×50，commit e32def0）；人工 dev-ui-test 窗口验收待做
- 2026-09-XX 新增需求（用户）：附件点击在 VS Code 直接打开（含工作区外外部文件）→ doing
- 2026-09-XX 点击打开附件完成（commit df2b28f，AI 验证：chip 点击发出 openAttachmentFile、× 移除不触发打开；typecheck + 317 test + build）→ done
- 2026-09-XX 主线合入测试通过（merge 2a3a2b4，typecheck + 317 test + build），人工 dev-ui-test 窗口验收通过 → closed

## 附件存储生命周期：清理策略 + 扫描防抖 + 工作区候选安全

slug: attachment-storage-lifecycle

- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-04 方案讨论拍板：清理不做应用级（跟随 dsh 归档只标记不删、保留恢复能力）；扫描优化参数定案（lstat 跳 symlink、深度 1、子目录上限 64、候选池缓存 + 目录 mtime 指纹失效、上限 200）；注释误述两处随代码修；shouldFoldPastText 不变 → open（未认领开发）
- 2026-09-04 认领（open → doing，worktree: agent/attachment-storage）：按方案实施——扫描优化（lstat 跳 symlink、子目录上限 64、候选池缓存 + 目录 mtime 指纹失效、query 内存过滤）与两处注释修正；清理不做应用级，随 dsh 归档语义。
- 2026-09-04 开发完成（doing → done，worktree: agent/attachment-storage，dev-finish @ 81058cd）：方案第 2/3 条落地——扫描优化（lstat 跳 symlink、子目录排序后前 64、候选池按 cwd 缓存 + 已扫目录 mtime 指纹失效、query 池上内存过滤、总数上限 200、webview 250ms 防抖不变，新模块 src/ui/workspaceScan.ts）+ 两处注释修正；清理不做（第 1 条）与 shouldFoldPastText 不变（第 4 条）、归档命令不做附件联动（第 5 条，确认）。自测：typecheck + 397 项单测（含新增 workspaceScan 11 项）+ build 全绿；测试报告 test/sandbox/verify.attachment-storage.report.html——宿主侧扫描行为驱动不可达，由单测覆盖，R-01 聊天主流程回归通过（沙盒 --instance attachment-storage，端口 8085）。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 折叠块展开后底部缺收起入口（思考 / 工具调用等）

slug: chat-block-collapse-footer

- 2026-09-05 用户反馈（展开后底部无收起入口）→ 建条目（open/）
- 2026-09-05 认领（doing）：开 worktree 开发
- 2026-09-06 开发完成（doing → done）：底部「收起」按钮落地（worktree 8427783），视觉验收 F-01/02 + 回归 R-01/02/03 全 pass，报告 test/sandbox/verify.chat-block-collapse-footer.report.html
- 2026-09-06 主线合入完成（dev-merge 成功，--no-ff 合入）→ closed：复测 588 单测全过 + build 成功 + 基线 49 场景视觉冒烟全出（collapse-footer 两张分步截图与既有 conversation 等场景核对无回归）

## 聊天输出代码块复制的「已复制」反馈被流式重建冲掉

slug: chat-code-copy-feedback-flash

- （无变更记录）

## 聊天内容留白（748px 居中）+ 代码块复制按钮重叠（限宽修复）

slug: chat-content-whitespace-width

- 2026-09-05 用户反馈（代码块复制按钮与右侧对话条重叠 + 追问留白是否记录——核查：留白讨论在 session 55c489e9 有结论但从未落 backlog，记录习惯缺口）→ 建条目（open/，两条合并）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree chat-content-width）；纯 CSS 限宽（748px 居中 + 窄屏自适应）；harness 1280/700px 渲染核对（Copy 按钮分离、工具卡/消息布局不破）
- 2026-09-05 开发完成（doing -> done）：typecheck/567 单测/build 全绿；ledger 4 项全过；真机 reload 复核由用户完成
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main；ledger 4 项全过、审查通过（1280/700px 截图核对）；真机 reload 复核交用户。版本归属待用户定：1.2.0 修复集合与发布节奏由用户另行指示。

## 对话消息里的文件链接可点击打开（含工作区外文件）

slug: chat-file-links-open

- 2026-09-02：open 条目。已核实：渲染/点击链路与宿主打开能力；工作区外文件可直接打开；相对路径需会话 cwd（基线有、未透传）。
- 2026-09-02：认领（open → doing），worktree 开发中。
- 2026-09-02：开发完成（doing → done），自测通过（typecheck/test/build），待人工 dev-ui-test 验收后合入。
- 2026-09-02：dev-ui-test 反馈 .xlsx 链接报「binary」打不开，已补：文件存在但编辑器打不开时退化到系统默认应用打开（openFileInEditor 三处共用，链接/产物/附件行为统一）。
- 2026-09-02：主线合入（merge commit cc37d52），dev-merge 复测（typecheck/test/build）通过，dev-ui-test 人工验收通过 → closed。

## 对话框图标直接使用 dsh web 的图标

slug: chat-icons-from-dsh-web

- （无变更记录）

## chat 正文反引号路径（行内码）不可点击打开，也无复制入口

slug: chat-inline-code-path-interact

- 2026-09-06 用户提出（原型图地址反引号路径不可点、复制繁琐，给出可点击打开 / hover 复制两种可接受方案）→ 核实现状（行内 code 无交互；markdown 链接与产物 chip 已可点；宿主 openPath 现成）→ 建条目（open/）
- 2026-09-06 认领 → doing。用户拍板开工：方案 1+2 组合——行内码路径形状可点击打开（复用 isFilePathHref 与宿主 openPath），其余行内码 hover 复制按钮。
- 2026-09-06 开发完成，自测通过 → done（worktree: agent/chat-inline-code-path-interact，done 标记 c43bf87；沙盒验收 F-01..F-04 + R-01 全 pass，报告 test/sandbox/verify.chat-inline-code-path-interact.report.html）
- 2026-09-06 主线合入测试通过（591 tests + build），人工确认 → closed（merge commit 4d3f223）

## chat markdown 渲染补全（非表格的 GFM 元素缺样式）

slug: chat-markdown-render

- （无变更记录）

## 聊天 tab 切走再切回后空白（webview 隐藏后重载无状态恢复）

slug: chat-panel-blank-after-tab-switch

- 2026-09-06 核实根因 → open（未授权修改）
- 2026-09-06 认领修复 → doing
- 2026-09-06 开发完成，自测通过 + 人工 dev-ui-test 验收通过 → done
- 2026-09-06 主线合入测试通过，人工验收通过 → closed

## chat 面板生命周期：关闭后点击变重命名；点链接面板内容被顶掉

slug: chat-panel-lifecycle-bugs

- 2026-09-05 认领（worktree: agent/chat-panel-lifecycle-bugs）→ doing
- 2026-09-05 开发完成，自测通过（typecheck/208 tests/build + harness 场景「markdown-link-click」验证链接点击不导航、openExternal 已发出）→ done
- 2026-09-05 追加（dev-ui-test 前用户要求）：右键外链菜单加「VS Code 内置浏览器打开」选项（单击仍系统浏览器；宿主 simpleBrowser.show，失败兜底 env.openExternal）；harness 新增 markdown-link-menu 场景 → done（补记）
- 2026-09-05 主线合入测试通过（dev-merge 重放/复测全绿 + 用户 dev-ui-test 验收通过），人工确认 → closed

## 消息列表增量更新（替代每帧全量重建）

slug: chat-render-incremental-update

- 2026-09-05 用户拍板开始阶段 2；从 chat-render-scaling（已 closed）拆分本条目 → open
- 2026-09-10 认领（open → doing）：阶段 2 消息列表增量更新开发 session 认领，worktree slug chat-render-incremental-update
- 2026-09-10 开发完成（doing → done，worktree agent/chat-render-incremental-update HEAD 27b3777）：实现消息列表增量更新——render() 不再每快照 `messages.textContent=''` 全量重建，改为按期望流（older 入口、消息行 + workflow 卡 anchorSeq 插流、命令通知、空态提示、turn-status、steering、jump-latest）与现有 DOM 按稳定 key 对账（reconcileFlow），未变行原元素保活，只对新增/删除/内容变化的行动 DOM。key 由消息 id 承担（旧位置键 m<下标> 在 loadEarlier 补页后与右键复制/hover 缓存/detail 展开态错位，一并消除）；行级定时器（turn-status clock/retry 倒计时）归行所有、dispose 清理；`.messages` 加 overflow-anchor:none 防原生锚定与程序补偿双补偿。验收：test/ui/mutation-driver.html 同一驱动 14 帧流式重投（改动前基线 added=238/removed=231/records=252 → 改动后 22/15/37，流式帧每帧 16/16 全量 → 1/1），终态 DOM 顺序逐项一致、finalTextHash 相同、mid-history 补页滚动补偿逐帧序列一致；沙盒（mock-llm+真 dsh+真扩展 vsix）5 项全过（真流式回显探针全程 added=9/removed=6、工具卡、bash 卡、提问面板、子代理）；harness 基线 33 场景截图核对（含 workflow-running/steering/history）+ harness 交互回归（details 展开保活、hover 缓存恢复、右键复制、流式追加）；typecheck + 477 单测 + build 全绿。报告 test/sandbox/verify.chat-render-incremental-update.report.html。注：mock 沙盒 settings 无 policy 段，bash 升级调用 dsh 默认放行（无审批面板，非本任务改动项）；「加载更早」50 条历史窗口场景由 harness 驱动页覆盖（沙盒不构造大历史）。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed；阶段 3（P1：token 用量明细 + 回合导航）待排

## chat 面板 P2/P3：字号调节 + 定时计划 chip（聚合折叠可选）

slug: chat-render-options-p2p3

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P2 两项必做 + P3 可选评估）→ open
- 2026-09-05 认领（open → doing）：阶段 4（P2/P3）开发 session 认领，worktree slug chat-stage4-p2p3；已核实 dsh-v0.1.2-rc.1 官方 schedule 投影存在（packages/schedule/schedule projection.ts：key='schedule'，wire 视图 = 活动记录数组），0.1.1 服务器无此投影（无基线/无推送 → host 保持 undefined → 不显示 chip，降级自然生效）
- 2026-09-05 开发完成（doing → done，worktree agent/chat-stage4-p2p3 HEAD 34062c1）：P2 两项 + P3 评估决定。
- 2026-09-05 主线合入后人工确认（阶段 4 验收通过）→ closed；chat 面板改造全部阶段收口

## 聊天渲染扩展性：缩略图请求风暴 + 虚拟化 + undo 栈

slug: chat-render-scaling

- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-04 主 session 拍板：四件全做（含虚拟化与 undo 迁移，不裁剪）；排期后置；开发前按当时代码重新核实 → 条目更新（仍 open/）
- 2026-09-09 开发前重新核实完成（按当时 main 代码逐项复测）：①风暴仍存在（新增：无限 5s 重试、requestAttachment 同款无过滤、host 读全文件非缩略图）；②虚拟化仍是大改动，新增更便宜的增量更新中间方案；③undo 问题确认仍在，方案降级为 execCommand insertText、砍掉 contenteditable 迁移；④hover 原描述过时（间隙抖动未复现），真实残留为流式重建丢高亮；更新拆分建议 → 条目更新（仍 open/）
- 2026-09-05 与 dsh-0.1.2-interaction-gaps 合并规划（用户拍板）：原 Sprint 4 + Sprint 5 合并为一个「chat 面板改造」序列，阶段表见下；本条目为主，interaction-gaps 条目同步标注。虚拟化=后手（长会话实测仍卡再做）。
- 2026-09-05 认领（open → doing）：阶段 1 拆 1A/1B 两条并行开发线——1A host 侧限流+失败收敛（本 session，slug chat-render-scaling-1a）；1B webview 侧 hover 恢复+undo（并行 session，slug chat-render-scaling-1b），不单独记 backlog；两线成果在本条目 done 变更记录一并注明。
- 2026-09-05 开发完成（doing → done）：阶段 1A host 侧限流+失败收敛（worktree chat-render-scaling-1a，HEAD 3870e32）——requestFileThumb/requestAttachment 走串行队列并发上限 4（原来一次渲染 N 图同时读 N 个完整文件，MB 级 base64 齐发），单任务超时/失败最多 2 次尝试后回 fileThumbFailed（新契约消息），webview 按失败态不再无限 5s 重发（fileThumbRequested 时间戳 Map 改 {at,failed}）；语义保持：成功路径渲染行为不变，失败文件最终呈现占位图标。自测 typecheck/test（477）无回归 + 7 项新增单测 + 沙盒验收（41 图全量渲染、缺失文件收敛、主流程回归）全过，报告 test/sandbox/verify.chat-render-scaling-1a.report.html。阶段 1B（webview 侧 hover 缓存恢复 + undo execCommand，slug chat-render-scaling-1b）由并行 session 开发中，完成后另记。
-  阶段 1B 开发完成（worktree chat-render-scale-1b，HEAD 4ed017a）：hover 缓存恢复（refHoverCache + renderMessage 重建恢复，鼠标不动高亮不丢）+ undo execCommand（composerInsertText 统一入口，7 个交互插入点改造，还原/清空路径保持 .value=；实测确认连续 execCommand 合并一个 undo 组、程序化插入与真实键入分属不同组；mac 上 Ctrl+Z 非 undo 键用 Cmd+Z，Linux/Win 待真桌面确认）。自测：诊断脚本 10/10（hover 重建恢复/物理移开不粘滞/undo 两步可退）+ 基线 33 场景 + 交互发送流式回归 + 470 单测全绿；报告 verify.chat-render-scale-1b.report.html（8 项全 pass）。阶段 1（1A+1B）全部完成。
- 2026-09-05 主线合入（阶段 1A + 1B 串行）后人工确认 → closed；阶段 2（消息列表增量更新）待排

## 滚动贴底跟随判定漂移：流式抖动 / 「回到最新」误显 / 切回位置错

slug: chat-scroll-pinning-drift

- （无变更记录）

## 流式输出视口周期脉冲（脱底→吸回跳动）：程序 pin 的 scroll 事件自我回声锁

slug: chat-scroll-stream-jitter-self-lock

- 2026-09-02 记录问题；headless Chrome + mock host 实测确认根因（程序 pin 自我回声锁 → 脱底-吸回周期脉冲）；写修法方向 → open
- 2026-09-02 认领（worktree: agent/chat-scroll-stream-jitter-self-lock）→ doing
- 2026-09-02 开发完成（分支自测通过 + done 标记 e164d49），主线合入（merge e164d49）测试通过，用户人工验收通过 → closed

## chat 窗口的会话操作入口：头部 ⋯ 菜单 + 编辑器 tab 右键高频项

slug: chat-session-actions

- （无变更记录）

## chat 编辑器 tab 标题跟会话名 + tab 图标用 dsh 官方图标

slug: chat-tab-title-and-icon

- （无变更记录）

## 回合导航（TurnNavigator：轨道栏 + 未载入回合跳转）

slug: chat-turn-navigator

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P1 项）→ open
- 2026-09-05 认领（open → doing）：阶段 3-P1 回合导航开发 session 认领，worktree slug chat-stage3-p1
- 2026-09-05 开发完成（doing → done，worktree agent/chat-stage3-p1 HEAD ebe4125）：实现回合导航——host 折叠 turnOutline 投影（官方 session-turn-outline wire 视图，session/projection + follow/control 基线，校验 turn 严格递增+形状）；webview 消息流右上竖直轨道栏（sticky 悬浮，≥2 回合出现，已载入/未载入同显，hover preview 气泡，最新回合高亮）；点击未载入回合 → turnJump(seq) → host 循环 loadEarlier 覆盖目标 seq → turnJumped 回传首行消息 id → webview 释放吸底滚动定位（user/command/compaction 消息补 seq 字段做锚；navigateAnchorOf 纯函数）。自测：typecheck + 495 单测（新增 navigateAnchor 3）+ build 全绿；harness 场景 turn-navigator / -preview / -jump（点击断言 __posted turnJump seq=200）；沙盒端到端：轨道栏出现+hover preview、已载入回合点击跳转真实定位（60 回合长会话）。注：沙盒 follow 快照在 124 条消息下未截断，未载入回合翻页循环未沙盒端到端触发（既有 loadEarlier 薄封装 + harness 断言 + 单测覆盖，见报告 coverageNote）。报告 test/sandbox/verify.chat-stage3-p1.report.html。
- 2026-09-05 主线合入后人工确认（阶段 3 验收通过）→ closed

## 回答末尾 token 用量明细（药丸+弹窗）

slug: chat-turn-usage-detail

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P1 项）→ open
- 2026-09-05 认领（open → doing）：阶段 3-P1 token 用量明细开发 session 认领，worktree slug chat-stage3-p1
- 2026-09-05 开发完成（doing → done，worktree agent/chat-stage3-p1 HEAD ebe4125）：实现官方 turn-usage 语义的用量折叠（src/pure/turnUsage.ts 增量状态机：attempt 生命周期、计数安全、总量自洽、缺边界整项缺省），ConversationFolder 按 turn/start 在窗口门控建 fold、turn/end 挂到 turnEnd 消息；webview 操作栏加「Usage N tokens」药丸 + 锚定明细弹窗（provider/model、缓存命中
- 2026-09-05 开发完成（doing → done，worktree agent/chat-stage3-p1 HEAD ebe4125）：实现官方 turn-usage 语义的用量折叠（src/pure/turnUsage.ts 增量状态机：attempt 生命周期、计数安全、总量自洽、缺边界整项缺省），ConversationFolder 按 turn/start 在窗口门控建 fold、turn/end 挂到 turnEnd 消息；webview 操作栏加「Usage N tokens」药丸 + 锚定明细弹窗（provider/model、缓存命中率、未缓存输入/缓存读取/缓存写入/输出/其中推理）。自测：typecheck + 495 单测（新增 15）+ build 全绿；harness 场景 turn-usage-detail / turn-usage-no-buckets；沙盒（mock-llm + 真 dsh 0.1.2-rc.1 + 真扩展 vsix）端到端：药丸出现、弹窗字段与缺省行正确（mock 适配器上报 usage 全 0，链路验证不受影响）。报告 test/sandbox/verify.chat-stage3-p1.report.html。
- 2026-09-05 主线合入后人工确认（阶段 3 验收通过）→ closed

## chat webview 断连可见性 + 凭证兜底 + 重启实测

slug: chat-webview-reconnect-visibility

- 2026-09-05 用户要求（讨论「我们自己能规避官方 GUI 冻结问题么」后确认的三条之一）：建条目（open/）
- 2026-09-05 用户要求（对照主线最新状态复核修改方案）：chat-column-layout 合入未触动本方案涉及的文件，方案主体不变；修正凭证兜底的问题描述与方案精度（manager 知情路径凭证链已闭环，兜底只剩外部替换/cookie 过期窄边），实测项同时验证自愈假设
- 2026-09-05 用户收窄范围（只做前端体验部分）：建议方案拆为「本期范围」（断连横幅+沙盒实测）与「暂缓项」（凭证兜底）
- 2026-09-05 认领（worktree: agent/chat-webview-reconnect-banner，只做断连横幅+沙盒实测，凭证兜底暂缓）→ doing
- 2026-09-06 开发完成，自测通过 → done（worktree: agent/chat-webview-reconnect-banner；断连横幅三相位 + 立即重连按钮 + kill/respawn 沙盒实测 4 项全 pass，报告 test/sandbox/verify.chat-webview-reconnect-banner.report.html；实测发现 dsh 0.1.1 重连后无 pending 事件时不发 session/subscribed（静默挂 socket 但事件照常流），重连成功信号放宽为「本会话任意帧到达」）
- 2026-09-06 主线合入测试通过，人工确认 → closed（dev-merge 合入 main 7f6da71，rebase 解 2 处冲突：l10n bundle 新增行与 webview render 清理循环（主线同期加了 rebuildingHeader/keepQueue/keepGoalBar，横幅保活行并入）；主线回归复测 typecheck/591 tests/build/i18n 门禁全过）

## 748 限宽一刀切：浮标撑通栏、压缩/workflow 卡贴左、与其余区域不对齐

slug: chat-width-blanket-rule-misalignment

- 2026-09-06 用户反馈「当前 chat 区域界面非常乱」（1.1.0 后宽度提交引入）→ 核实：
- 2026-09-06 视觉回归实测（v1.1.0 worktree 构建 vs 当前，138 场景全量 before/after + 像素 diff 分类 + 关键场景逐张核对）：
- 2026-09-06 认领（open -> doing）：用户指示彻底修改（不治标）、布局对齐 dsh web 最新源码。
- 2026-09-06 开发完成（doing -> done）：列容器化重构（.flow-col 统一居中列 + jump-latest toBottomSlot
- 2026-09-06 合入（done -> closed）：dev-merge 合入 main（复测 typecheck/568 单测/build 全过，dist 已重建）；用户主线 reload 实测通过（列居中对齐、jump pill、头部 preset chip 恢复）。

## CI 平台矩阵（3 OS + package + spawn 冒烟）

slug: ci-platform-matrix

- （无变更记录）

## CI 失败：vsce package 拒绝 README 中的 SVG 横幅

slug: ci-vsce-svg-readme

- 2026-09-02 核实并记录 → open
- 2026-09-02 认领 → doing
- 2026-09-02 开发完成，自测通过（typecheck + 336 tests + build + package 本地验证通过）→ done
- 2026-09-02 主线合入测试通过（CI 三平台全绿），人工确认 → closed

## 客户端持久化状态迁到 dsh 全局目录（~/.dsh）

slug: client-state-to-dsh-home

- 2026-09-06 用户提出（内部持久化状态应放 dsh 全局目录，回收站为例）；逐个盘点 11 个 key 后用户拍板：回收站 + 分组（定义/归属）+ 置顶 + 未读搬走，视图偏好（排序/折叠/回收站折叠/选中组）不搬，modelWindowCache 本次不动；文件布局定为每功能一个文件 → 建条目（open/）
- 2026-09-06 认领（worktree: agent/client-state-to-dsh-home；本次把 tags/sessionTags 一并纳入落盘迁移，供派生脚本 --tag 归组）→ doing
- 2026-09-06 开发完成（doing → done，worktree client-state-to-dsh-home，branch agent/client-state-to-dsh-home，HEAD fecb3a8）：五组客户端状态（回收站/分组+归属+选中组/标签组+归属/置顶/未读）迁到 ~/.dsh/dsh-one/*.json——用户中途拍板选中组（activeGroupId）也进 groups.json（"标签页本身属性类型的需要保存"），排序/折叠类视图偏好留 Memento。新增 src/pure/dshStateFile.ts（解析/三态决策/字段级合并）+ src/ui/dshStateStore.ts（原子写/读-合-写串行队列/fs.watch 热重载），sessionsStore 改 async create()（首启旧 Memento 迁移：写成功才删旧 key）；mk-sessions-modern.py 加 --tag（一次派生 = 侧栏一个标签组）。子代理评审抓出 1 blocker（emptyTagFile 缺预设组导致全新安装打组静默不落盘，6f52f30 修）+ 2 should-fix（回收站 mutator 全量语义误删并发窗口条目，e5a73ad 修）均已修复回归。自测全绿（typecheck/test 638/build）；沙盒 E2E 7 项全 pass（verify.client-state-to-dsh-home.ledger.report.html：F-01 脚本写文件热重载出组、F-02 UI 写回文件含全新安装场景、F-03 迁移单测覆盖+边界说明、F-04 重启纯文件恢复、R-01~R-03 回归）。注意：code-server 不水合 Memento（沙盒全局限制），真实旧版→新版迁移需在桌面 VS Code 人工验收（dev-ui-test）。评审 nits 留档：watcher 出错后热重载静默失效无恢复；writePending 期间 reload 跳过无补偿重试（极端时序漏一次，下一次事件追平）。 后应用户要求补全程决策日志（92ed06d：create 逐模块权威来源/迁移结果、IO 层写失败原因/坏文件/watch 状态、reload 跳过原因与变更模块，Output 频道「DSH One」client-state 前缀；沙盒 output_logging 已实证）并用最新 vsix 重跑 E2E 全过。
- json 有、dsh 没有（幽灵 id）：回收站自动清账（pruneRecycleBin 按 knownSessionIds 对文件清账，基线就绪后执行）[代码][E2E]；pinned/unread/sessionTags/membership 惰性保留不渲染——归档会话恢复后状态原样回来，误清代价大于留存成本 [代码]
- dsh 有、json 没有：新会话常态，无状态平铺 [推演]
- sessionTags 指向不存在的组 id：parse 时 sanitizeSessionTagIds 直接丢弃 [代码]
- activeGroupId 指向不存在的组：parse 时回落 null（全部工作区）[代码]
- 同 id 同时在 pinned 和 recycleBin（只能手改文件造成）：回收站优先，行进抽屉不渲染主列表，恢复后 pin 还在 [推演]
- json 里塞大量假 id（手改）：惰性不渲染，无性能问题（渲染只遍历基线会话）[推演]
- 迁移中途进程被杀：粒度是单模块——已迁模块文件权威+旧 key 已删，未迁模块旧 key 还在、下次启动重迁，无中间坏态 [代码]
- 两个窗口同时首启迁移：双方都走 merge（并集/按 id 合并），不互丢；activeGroupId 先写的赢（prev ?? value）[代码][单测]
- 文件存在但损坏 + 旧 Memento 已删：fresh start，状态丢失；有 `did not parse ... treated as missing` warn；下一次写自愈覆盖坏文件 [代码]
- 空文件/空字符串文件：parse 失败按缺失处理，同上 [代码]
- 旧版新版并存（罕见，如多 user-data-dir 版本不齐）：旧版继续写 Memento，新版文件权威后下次启动把旧版写回的 key 当陈旧值再删——旧版窗口里的新操作不进文件、重启新版后丢失。VS Code 正常统一升级不会遇到 [推演]
- 同窗口连续快操作：promise 队列串行，读-合-写不丢 [代码][单测]
- 跨窗口/脚本同时写同一文件：last-writer-wins，丢后到的那一个增量（窗口=读文件到 rename 之间，毫秒级）。人手工几乎撞不上；脚本批量写 tags 与插件同时写 tags 是主要暴露面，双方都读-改-写把概率压到最低 [代码][推演]
- writePending 期间收到 watch 事件：跳过 reload（防读到写前旧值回退内存），写落定的 rename 事件会补一次；有 skip 日志 [代码]
- 上述跳过的极端变体：外部写恰好落在插件读-写之间被覆盖、其事件又被 skip → 无补偿，该增量真丢。需三方同毫秒撞同一文件，接受的固有代价 [推演]
- persist 写失败（磁盘满/权限）：内存态照常、warn 两条（io 层原因 + persist 层模块）；之后任何 watch 事件触发 reload，文件权威会把内存里未落盘的变更抹掉——"我打的组消失了"类现象查 warn 日志 [代码]
- 自己的写回响：debounce 后读文件与内存逐模块相等 → 不重建不通知不打日志 [代码][E2E：自己的写不产生 reload 日志]
- 手改坏 JSON/版本号不符：load/reload 按缺失处理（保持内存/走迁移）+ warn；update 写时 prev=empty 覆盖自愈 [代码][单测]
- ~/.dsh/dsh-one 目录被整个删掉：写路径 mkdir 自愈；但 watcher 挂旧 inode 静默失效（热重载死到重启）——留档 nit，低频 [推演]
- tmp 残留（写一半被 SIGKILL）：随机后缀 tmp 文件不影响 load（只读固定文件名）；极少量残留无害 [代码]
- watcher error（inotify 耗尽等）：warn 日志，热重载失效无自动恢复——留档 nit [代码]
- 升级到本版：首启迁移，逐模块日志可查 [E2E（日志实证）]
- 降级回旧版：Memento key 已删，状态不回迁（条目拍板接受）[代码]
- 新版插件 + 旧版脚本/无插件 + 新脚本：脚本写的文件没人读就静等；新版启动即文件权威，向后兼容 [推演]
- 2026-09-06 主线合入（dev-merge 复测 typecheck/test/build 全绿），用户在 Windows 实测无问题 → closed

## markdown 代码块折叠 + 复制

slug: code-block-collapse-copy

- （无变更记录）

## commit 悬浮卡在流式输出期间跳动（帧帧关→开）

slug: commit-card-jumps-during-streaming

- 2026-09-07 问题记录（open）：现象截图（流式中 commit 卡悬浮在聊天记录上、底栏
- 2026-09-07 认领（open -> doing）：worktree 开发（分支 agent/commit-card-jumps-during-streaming）。
- 2026-09-07 开发完成（doing -> done）：worktree 开发（分支 agent/commit-card-jumps-during-streaming）。
- 2026-09-07 合入（done -> closed）：dev-merge 合入 main（2742f83），沙盒报告 10 项全过、人工审查通过；ledger test/sandbox/verify.commit-card-jumps-during-streaming.ledger.json。

## commit 卡片：不依赖当前窗口打开的文件夹，任意窗口状态都能显示

slug: commit-card-window-independent

- 2026-09-03 用户反馈「卡片要当前文件夹在 VS Code 打开才显示」→ 核实（数据源仅 vscode.git API；内置 git 仓库发现 = 当前窗口 workspace folders 扫描 + `git.scanRepositories` + 打开的编辑器，默认扫描深度 1）→ 调研（git CLI 兜底可行：dsh server 恒本机、会话 cwd 本地路径、`a5c9358` 实测字段齐全）→ 记入 open/（未开始修改）。
- 2026-09-03 用户追问「兜底要用户装 git 么」→ 核实内置 git 扩展源码（`git.path` 设置、`git.missing` 门控、找不到 git 的提示）→ 明确不新增依赖，补「git 依赖说明」节。
- 2026-09-04 Sprint 3 认领（worktree: agent/commit-card-window-independent）：实现 git CLI 兜底（vscode.git 未命中 → 会话 cwd 仓库根 + git show/log 拿全字段 + origin 推 GitHub 链接；点击打开 = GitHub commit 页兜底），任意窗口状态显示 commit 卡。
- 2026-09-04 开发完成（worktree f5210c9，分支 agent/commit-card-window-independent，dev-finish 自测通过 + done 标记）：① vscode.git 未命中时 git CLI 兜底查询（会话 cwd rev-parse --show-toplevel → git log --no-walk 批量 --shortstat 拿全字段；git.path 设置对齐；失败静默保持灰显）；② 点击打开：无 git model 仓库时 GitHub 链接浏览器开 commit 页兜底；③ 解析/投影收敛到 src/pure/commitGit.ts + 9 个单测；④ 验收报告 test/sandbox/verify.commit-card-window-independent.report.html（F-01 新增 / R-01 灰显 / R-02 回显，三项全 pass，沙盒实例 commit-card-independent 独立验证）。
- 2026-09-05 主线合入后人工确认（用户确认开发完成）→ closed

## 聊天消息 commit hash 联动：点击打开 Git 提交视图，悬浮显示提交信息

slug: commit-hash-interactive

- 2026-09-02 记录需求并核实：`git.viewCommit` 命令 + Git 扩展 exports API（`getAPI(1)` → `repository.getCommit(ref)`）可行；内置 Git 无 commit URI handler；dsh-one 复用 `sessionOpen` 通路。方案（识别/点击/悬浮/误伤控制）待确认 → open
- 2026-09-02 Sprint 2 前定稿 5 个待确认点（识别范围用户拍板仅正文，其余按推荐）
- 2026-09-02 认领（Sprint 2 节点，worktree: agent/commit-hash-interactive）→ doing
- 2026-09-02 开发完成（feat(commit-hash) 三提交：正文 hash 识别为可点击 chip / 点击打开 git 提交视图 / 悬浮提交信息，自测 typecheck+test+build 通过，i18n 门禁通过）→ done
- 2026-09-02 主线合入测试通过，人工 dev-ui-test 窗口验收通过 → closed

## commit 悬浮卡超出面板视口，被 VS Code 界面裁掉

slug: commit-hover-card-clip

- 2026-09-02 用户反馈（补充问题）→ open
- 2026-09-02 认领（worktree: agent/commit-hover-card-clip）→ doing
- 2026-09-02 开发完成，自测 + 视觉验收通过 → done
- 2026-09-02 主线合入测试通过（merge 4f93cbe），人工窗口验收通过 → closed

## composer 长文本滚动窗口跟随光标（输入路径滚动同步不依赖 scroll 事件时序）

slug: composer-caret-follow-sync

- 2026-09-05 主线代码研究 + harness 真实按键复测后定位（事件时序依赖），待修复，先记录 → open
- 2026-09-05 认领（worktree: agent/composer-caret-follow-sync）→ doing
- 2026-09-05 开发完成，自测通过（569 测试 + Playwright 真实按键/拦截 scroll 对照 + harness 全场景 142 个）→ done
- 2026-09-05 主线合入测试通过（569 测试 + 基线冒烟 45 场景 + 无 scroll 事件兜底抽查 PASS），人工确认 → closed

## composer 一键清空按钮（输入框右上角 ×）

slug: composer-clear-all-button

- 2026-09-03 用户提出需求，核实现状后讨论必要性（认可做，作本地增强）→ open
- 2026-09-06 认领（agent/composer-draft-clear，worktree .worktrees/composer-draft-clear）→ doing
- 2026-09-06 开发完成（agent/composer-draft-clear）→ done。自测：typecheck/test（386 全绿）/build 通过；真 dsh E2E（沙盒 mock-llm）：填文本 → 点 × → 输入框为空、按钮隐藏 ✓；harness 场景 composer-clear-all / composer-clear-all-click ✓（报告 test/sandbox/verify.composer-draft-clear.report.html，7 项全 pass）
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## composer 草稿在 pending 卡接管时丢失

slug: composer-draft-lost-on-pending

- 2026-09-03 用户提出需求（弹卡不丢草稿），核实根因并实测复现 → open
- 2026-09-06 认领（agent/composer-draft-clear，worktree .worktrees/composer-draft-clear）→ doing
- 2026-09-06 开发完成（agent/composer-draft-clear）→ done。自测：typecheck/test（386 全绿）/build 通过；真 dsh E2E（沙盒 mock-llm）：问答 pending 接管 → 应答后草稿恢复 ✓；harness 场景 pending-typing-draft 草稿保留断言 ✓（报告 test/sandbox/verify.composer-draft-clear.report.html，7 项全 pass）
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## composer 草稿按 session 保存（文本与附件，切换会话不丢不搬家）

slug: composer-draft-per-session

- 2026-09-0X 需求确认 → open
- 2026-09-0X 认领 → doing
- 2026-09-0X 开发完成（worktree agent/composer-draft-per-session，commit 5429d31/2f7d937）：webview 内存按 session 归档文本与附件，切换时存旧取新；`draftRestoreFor` 标志区分切换帧（hero 同会话帧不被误判覆盖）；顺带修复 interactive mock 加载顺序（chatWebview 撞 mockHost TDZ 页面空白）。自测 typecheck + 317 tests + build 全绿；WebBridge 交互验证通过（sess-1 草稿A ↔ sess-2 草稿B 互不污染、附件 chip 随会话恢复、hero 同会话刷新不覆盖输入）。→ done
- 2026-09-0X 人工 dev-ui-test 验收通过（用户）；主线合入（merge 56db924），复测 typecheck/317 tests/build 全绿 → closed

## 发送/清空后 composer 高亮层残留「鬼影」+ 首帧前回填文本被吞

slug: composer-ghost-after-send

- 2026-09-08 用户反馈 → 排查定位（Playwright 复现两个缺陷）→ 开发完成提交（worktree）→ open 条目直接建立并认领（doing）
- 2026-09-08 开发完成（worktree agent/composer-ghost-after-send，commit 39e7e24）：sendCurrent 清空后补高亮层就地收尾 + 首帧空态归档保留 stashedDraft + harness 基线场景 composer-clear-after-send；自测 449/449 测试通过、typecheck 通过、浏览器诊断 A1-A5/B/C 全回填正常、dev-host 时序复现修复前后对比；验收报告 test/sandbox/verify.composer-ghost-after-send.report.html（F-01/F-02/R-01/R-02 全 pass）→ 待 dev-finish 打 done
- 2026-09-08 dev-finish 通过（自测 typecheck + 449/449 + build 全绿），done 标记 done/composer-ghost-after-send；doing → done，待主线合入
- 2026-09-04 主线合入后人工确认（用户确认合入）→ closed

## 输入长文本时上方对话区随每次按键跳动（贴底态瞬态 clamp + 补偿竞态）

slug: composer-input-jitter-pinned-scroll

- 2026-09-06 用户主线实机报告「输入长文本上方对话区不断跳动」→ harness+Playwright 复现与机制验证 → 确认（瞬态塌缩 clamp + 补偿竞态，非渲染重建）→ open
- 2026-09-06 认领（worktree: agent/composer-sticky-in-scroller-layout；结构修复随 composer-sticky-in-scroller-layout 一并落地）→ doing
- 2026-09-06 开发完成：seat 布局 + field-sizing 落地，探针实测输入零抖动；自测通过（typecheck/612 tests/build）+ 全量视觉回归 156 场景；ledger: test/sandbox/verify.composer-sticky-in-scroller-layout.ledger.json → done
- 2026-09-06 主线合入测试通过，人工确认 → closed（合入 31c7bd1）

## composer 输入超长文本溢出卡片（ref-token-layer 滚动同步平移整个层）

slug: composer-long-text-overflow

- 2026-09-05 主线复现并定位根因（ai-visual-validation harness 截图对照用户报告），输入框全量审计完成 → open
- 2026-09-05 认领（worktree: agent/composer-long-text-overflow）→ doing
- 2026-09-05 开发完成，自测通过（569 测试 + harness 全场景 142 个 + 沙盒真 webview 三态截图）→ done
- 2026-09-05 主线合入（merge 0259a16）测试通过（569 测试 + 基线冒烟 45 场景），人工确认 → closed

## composer 多行输入时聊天对话框上下跳动

slug: composer-multiline-input-jitter

- 2026-09-05 用户会话直报，主线排查（真实 chat STYLE fixture + 手动驱动 mock）确认根因 → open
- 2026-09-05 4 路并行子代理深析（现状盘点/几何建模/官方逆向/历史残留审计）收敛于 B+F2；用户拍板方案 1（机制层彻底），方案 2 布局重构另立条目 → 认领 → doing
- 2026-09-05 开发完成（worktree: agent/composer-multiline-input-jitter，commit f6f8f83）：RO 统一补偿 + 写路径收口（writeMessagesScrollTop）+ 字号特例 rAF settle。自测：typecheck/554 单测/build 全绿；headless Chrome CDP 几何断言与截图验证（顶出瞬态同帧修回、收缩侧贴底保持、非跟随阅读位不动、流式 dist 恒 0、dock 开合补偿）；harness 基线 35 场景无回归。测试报告 test/sandbox/verify.composer-multiline-input-jitter.report.html → done
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（from f6f8f83），报告 7 项全过、人工审查通过（before/after 截图核对）。

## composer 移入滚动容器（sticky-bottom 流内布局，对齐官方 dsh web）

slug: composer-sticky-in-scroller-layout

- 2026-09-05 由 composer-multiline-input-jitter 调查产出，用户拍板作为后续改进方向 → open
- 2026-09-06 官方 bundle 实证补全（composer-input-jitter-pinned-scroll 调查）：
- 2026-09-06 认领（worktree: agent/composer-sticky-in-scroller-layout；与 composer-input-jitter-pinned-scroll 合并开发）→ doing
- 2026-09-06 开发完成（worktree: agent/composer-sticky-in-scroller-layout，已 rebase 到 cf8e1c9+）：探针实测逐字输入消息区像素级静止；自测通过；ledger: test/sandbox/verify.composer-sticky-in-scroller-layout.ledger.json → done
- 2026-09-06 主线合入测试通过，人工确认 → closed（合入 31c7bd1）

## 空白对话切换模型后误显示「窗口未知」占位

slug: context-bar-blank-window-unknown

- （无变更记录）

## 上下文注入结构化 body（form：instructions/catalog/snapshot/notice/relay/recall）

slug: context-injection-structured-body

- 2026-09-01 记录（「能展开的都做成可展开」调研）→ open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-02 核实更新：对照上游类型/实现确认 6 种 form 协议与字段；确认 dsh-one 数据链路完整透传，纠掉「依赖 host 支持」；方案改为仓库内三步
- 2026-09-02 认领（Sprint 2 节点，worktree: agent/context-injection-structured-body）→ doing
- 2026-09-02 Sprint 2 开发完成，自测通过（typecheck/test/build，a366089）→ done
- 2026-09-02 主线合入测试通过，人工 dev-ui-test 窗口验收通过 → closed

## 切换模型后上下文窗口显示滞后

slug: context-window-switch-lag

- （无变更记录）

## 对话尾部产物文件行缺失（对齐 dsh web ProducedFiles）

slug: deliverables-produced-files

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过 → done（worktree: agent/deliverables-produced-files）
- 2026-09-01 用户 dev-ui-test 验收反馈：去掉「在 VSCode 中打开」按钮（产物 chip 打开文件已够用）→ 仍 done
- 2026-09-01 用户反馈「折叠后不能展开」→ 补「+N 个文件」展开/收起交互 + 视觉场景 → 仍 done
- 2026-09-01 用户反馈「文件过多时一行被截断」→ chips 行改可换行铺开 + `produced-files-wrap` 场景 → 仍 done
- 2026-09-01 主线合入测试通过，人工确认（用户 dev-ui-test + 视觉场景验收）→ closed（merge d8678d0）
- 2026-09-01 用户反馈死链 toast 只说「无法打开」不解释原因（实测：条目 git mv 到 closed/ 后 chip 变死链）→ 修复：失败时区分「已不存在（说明可能移动/删除）」与「其他失败（带错误详情）」，merge 1fa711a
- `chatContract.ts`：`ChatAssistantMessage.producedFiles?: string[]`（只挂 turnEnd 消息）；`FromWebviewMessage` 加 `producedOpenFile`（chip 点击打开文件）。
- `conversation.ts`：per-turn 产物累积器（call view 快照 + 产物去重保序 + turn/end 挂载，对齐官方 deliverablesDefinition）。
- 新增 `src/pure/producedFiles.ts`：chip basename（兼容 / 与 \）。
- `webview.ts`：turnEnd 消息在操作栏前渲染产物行——label「产物」+ 最多 6 个 chip（点击在 VSCode 编辑器打开）+ 超出的折叠成「+N 个文件」（**用户反馈后补的交互**：点击展开全部 chip、展开后变「收起」，展开态按消息位置键持久化、换会话清空；官方 web 是静态计数，此为 dsh-one 增强）。chips 行**可换行铺开**（用户反馈：单行 nowrap 会把展开后的长文件名截断——`.produced-lane` 改 `flex-wrap: wrap`，chip 内超过 320px 的名字仍省略号截断、悬停显示完整路径）。
- `chatView.ts`：产物行 CSS + `producedOpenFile` 宿主处理（`showTextDocument` 打开任意绝对路径）。
- 测试与场景：`conversation.test.ts` 6 个折叠用例（diff/edit 提取、read/delete/terminal 排除、失败结果排除、去重保序、turn 切断、re-baseline 清空）+ `producedFiles.test.ts` basename 用例 + `test/ui/scenarios.js` 新增 `produced-files`（折叠态）、`produced-files-expanded`（点击展开）、`produced-files-wrap`（长文件名多文件换行）三个视觉场景（均已并入 BASELINE_SCENARIOS）。
- 变更（用户 dev-ui-test 验收反馈）：官方 web 的「在文件夹中显示」按钮（曾实现为「在 VSCode 中打开」：工作区内 `revealInExplorer` / 未打开 `openFolder`）**已按用户确认去掉**——VSCode 里打开产物文件夹意义不大，chip 点击打开文件已够用；相应移除 `producedOpenFolder` 消息、宿主处理与公共文件夹计算。

## diff 视图宽度自适应：窄时退化单栏、宽则双栏

slug: diff-responsive-layout

- 2026-09-02 提出（用户建议 + 方案确认）→ open
- 2026-09-02 认领（Sprint 1 节点，worktree: agent/diff-responsive-layout）→ doing
- 2026-09-02 开发完成（worktree: agent/diff-responsive-layout，commit 79bd1bb）：`.diff` 设 `container-type: inline-size`，窄容器（≤480px）纯 CSS 切单栏——相同行只显一遍、修改行 old 红上/new 绿下、纯增/删灰空占位隐藏、行对加间距；宽容器保持左右分栏。typecheck / test（336 pass）/ build 全过，`done/diff-responsive-layout` 标记已打 → done
- 2026-09-02 主线合入测试通过，人工 dev-ui-test 窗口验收通过 → closed

## diff 视图改成左右分栏（side-by-side）

slug: diff-split-view

- （无变更记录）

## development.md 里 publisher 占位那句过时

slug: docs-publisher-stale-note

- （无变更记录）

## dsh 0.1.2-rc.1 交互层对照：自研面板缺口清单

slug: dsh-0.1.2-interaction-gaps

- 2026-09-08 调研 0.1.2-rc.1 release notes，对照 dsh-one 代码后建条目 → open
- **回合导航**：`TurnNavigator` 垂直轨道栏 + 未载入回合来自 host 侧投影 `turnOutline`（packages/session/session-turn-outline，以 turn/start 为锚带整份日志清单）→ `session.loadThrough(seq)` 翻页后定位。dsh-one 有等价翻页（historyWindow），缺投影订阅+UI+跳转落点。P1。
- **token 用量明细**：`TurnUsagePanel`/`TurnTimePanel` 药丸+弹窗；数据由 `turn-usage.ts` 折叠 turn 内每尝试的 usage，缺边界整项缺省。dsh-one 已有计时行且 usage 已到 host（turnTimingOf 消费 usage.outputTokens），只差聚合与 UI。P1。
- **字号**：`--dsh-content-font-size` px 变量链（12–17，默认 14），表格用派生变量联动，boot 防首帧闪烁。P2，VSCode 配置+webview 变量链即可。宽度拖拽不做（VSCode 原生可拖面板宽度）。
- **定时计划**：非响应式——标题区 chip+只读下拉（schedule 投影 state.active，仅 scheduled/overdue），创建/删除靠模型工具 schedule_create/list/delete。dsh-one 加 chip 是 jobs 同款模式。P2。
- **子代理模型配置**：入口在设置页插件卡（授权清单），非会话内；模型面参数仅 provider/model/reasoning_effort，无 max_tokens（仅 Host 配 agentOptions.maxTokens）；Claude Code/Codex 固定 model 不支持模型面选择。dsh-one 无设置插件卡体系，跟进成本高，**不做**（iframe 官方 UI 可配）。
- **模型目录搜索**：官方 composer 位（ModelSelect）无搜索框；搜索只在 /model 命令壳与设置页 ModelListEditor。dsh-one 模型菜单与官方 composer 位对齐，**不做**。
- **过程折叠**：官方为整轮聚合折叠 TurnProcessNodeView（turnProcesses 内存态，compact 模式），dsh-one 是逐块独立折叠。可选优化。
- 2026-09-05 与 chat-render-scaling 合并规划（用户拍板）：两条目合并为一个「chat 面板改造」序列，按 chat-render-scaling 条目「合并阶段表」执行——阶段 3/4（P1 token 用量明细、回合导航；P2 字号、定时计划 chip、P3 聚合折叠）承接本条目各级别项；不做项（宽度拖拽/子代理模型配置/模型目录搜索）维持不做。
- 2026-09-05 全部项处理完毕（用户授权监控收尾）：P1 两项（token 用量明细 chat-turn-usage-detail / 回合导航 chat-turn-navigator）与 P2 两项（字号、定时计划 chip，chat-render-options-p2p3）均已拆出开发并合入 closed；P3 聚合折叠评估后不做（与阶段 2 行级保活冲突，见 chat-render-options-p2p3 条目）；不做项（宽度拖拽/子代理模型配置/模型目录搜索）维持不做。本条调研记录归档 → closed。

## spike：用 dsh client-plugin 机制给官方 web GUI 打断连补丁（可行性调研）

slug: dsh-client-plugin-disconnect-patch-spike

- 2026-09-05 用户要求（「如果3有必要就做吧」，判断：日常重度使用浏览器 GUI + 上游排期不可控，spike 成本低，有必要）：建条目（open/），并派发调研 session
- 2026-09-05 spike session 完成，结论：可行（结论已转录上方「spike 结论」节，主线抽查四点属实）→ closed；实现条目另立 dsh-disconnect-banner-plugin

## 清理 dsh_embed=vscode 参数（官方从未消费）

slug: dsh-embed-param-cleanup

- 2026-09-08 调研确认：官方 0.1.2-rc.1 不消费 dsh_embed；主 session 拍板清理 → open
- 2026-09-04 认领（worktree: agent/dsh-embed-cleanup）→ doing
- 2026-09-04 开发完成，自测通过（typecheck/449 test/build），dev-finish 标记 done/dsh-embed-cleanup=73fd8a9；无 UI 行为变化，沙盒报告不适用，验证 = 仓库检查 + 文档一致性核对（test/sandbox/verify.dsh-embed-cleanup.report.html，D-01 pass）→ done
- 2026-09-04 主线合入后人工确认（用户已确认）→ closed

## dsh@next（0.1.2-rc.1）/api/* 新增 token 认证，扩展无法工作

slug: dsh-next-token-auth-incompatible

- 2026-09-03 沙盒 spike（docker code-server + dsh@next）中发现并核实，记录进 open/。
- 2026-09-04 主 session 核实 0.1.2-rc.1 源码（dsh-client-connection / dsh-api-gateway 子包）→ 认证模型定案（launch token 换签名 cookie；token 不可直接调 API；loopback 不免认证）→ 用户拍板按官方标准路径实施（解析 stdout → 换 cookie → 全链路带 cookie）→ 条目更新（仍 open/，未开发；实施时验证 reload/stdout 丢失场景）。
- 2026-09-06 认领（open → doing，worktree: agent/dsh-token-auth）：按方案实施 token 换 cookie 认证链路。
- 2026-09-06 开发完成（worktree: agent/dsh-token-auth, commits 0d977fb+1ed8849+be2f87b+c578762）→ done。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## slash 命令动态获取（commands/list），替换面板静态镜像表

slug: dynamic-slash-commands

- 2026-09-05 用户确认方向（动态获取 + 顺手修 kimi preset 缺 command-goal）→ 建条目（open/）
- 2026-09-05 认领（open → doing）
- 落地：dshRpc.listCommands（commands/list，同 commands/execute 的 client-request wire，agentId 参数）；ChatSessionController 附着即拉、setAgentPreset 后重拉，拉到前/失败不下发；webview 命令表改 state.slashCommands 驱动，静态表降级为 KNOWN_HOST_COMMANDS（fallback 名单 + l10n 描述覆盖层——宿主 description 仅英文，已知命令名沿用面板翻译，未知命令与 hint 用宿主原文）；/model 客户端拼接不变。HOST_SLASH_COMMAND_NAMES 保留（fallback/清单过期时宿主拒绝的定向提示仍靠它）。
- 实测：0.1.1-rc.2 有 commands/list（沙盒 probe curl，六条含 goal）；真 0.1.2-rc.1（dsh-sandbox-dsh-v012 + 临时 DSH_HOME 拷 kimi preset）standard 6 条有 goal、select → kimi 后 5 条无 goal、切 preset 清单即时生效；改后 kimi preset（补 command-goal）commands/list 恢复 6 条含 goal。
- 顺带产出：verify-driver 加 fillSlash/expectPopup 原语（补全弹窗断言，上个任务的一次性探针沉淀为仓库能力）。
- 沙盒报告：test/sandbox/verify.dynamic-slash-commands.report.html（7 项全过：3 新增 + 4 回归；kimi preset 无 goal 的 UI 差异在 0.1.1 沙盒无法构造，宿主语义层实测见 ledger coverageNote）。
- 仓库外：~/.dsh/.agent-presets/kimi/agent.cordis.yml 已补 command-goal 并对齐 0.1.2 注释（新会话生效）。
- 2026-09-05 dev-finish 通过（自测 + 报告 + done 标记）→ doing → done
- 2026-09-05 主线合入（dev-merge 复测通过）+ 用户确认 → done → closed

## 英文界面下 preset 文案显示中文（roster 文案无 locale 区分）

slug: en-locale-preset-chinese-copy

- 2026-09-03 用户反馈英文界面 preset 不带翻译 → 核实根因（服务端 preset.yml 固定中文 + 8b06be8 roster 优先使英文界面也拿到中文文案；zh bundle 译文已与 roster 逐字一致）→ 记入 open/（未开始修改）。
- 2026-09-04 认领（open → doing）：按条目方案实施——resolveAgentPresets 对 trust=system 且 id 命中内置映射的 preset 恢复内置映射过 t()（roster 只用于 user preset 与未知 id），随方案调整测试用例。
- 2026-09-04 开发完成（doing → done，agent/i18n-polish）：resolveAgentPresets 对 trust=system 且 id 命中内置映射的 preset 恢复内置映射过 t()（roster 只用于 user preset 与未知 id）；测试用例随方案调整；自测全绿（typecheck + 386 tests + build，check-i18n.sh 通过）；测试报告同条目 jobs-chip-label——en 沙盒（含修复 vsix 的私有容器）实测 hero/下拉/头部标签均英文、kimi user preset 保持 roster 原文；zh bundle 译文与 preset.yml 逐字一致，中文界面文案不变。方案里「refreshAgentPresets 传 vscode.l10n.t」已由 8b06be8 满足。漂移对照测试未加：roster 在 dsh 安装目录、不在本仓库，仓库内测试取不到；映射 key 入 bundle 已由 check-i18n.sh 存量检查覆盖。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 可展开块优化一批（diff / command 卡 / 推理块首行 / queue 计数）

slug: expandable-blocks-polish

- （无变更记录）

## 外部启动的 dsh 实例完全接管（停止/重启/连接浏览）

slug: external-dsh-manage-012

- 2026-09-06 用户拍板重开（全做：A+B+三平台；macOS 优先验证，Windows 有机器可测）；并入防护方案（401 指纹报错不另起，用户已拍板）→ 建条目（open/）
- 2026-09-06 主线开发 session 认领（open → doing）：按 adopted-dsh-takeover 调研结论直接动工，不改调研结论（无 shutdown RPC / POSIX SIGTERM 优雅路径 / 单 pid 杀 / 三平台 pid 探测）；dev-start external-dsh-manage 建 worktree 开发，完成后交主线 dev-merge
- 2026-09-06 开发完成（doing → done，分支 agent/external-dsh-manage）：A 档单 pid 停止/重启（确认弹窗 + ps 身份确认 + SIGTERM 优雅路径，Windows taskkill /T /F）与 B 档 token 粘贴连接（换票校验 + source:external/owned:false 共享记录，旧记录兼容）；防护默认动作改为认证 dsh 无 token 报错不另起。自动验证 = 单测 16 项新增（全量 552 通过）+ 真机探针 11/11（临时端口 3099 真 dsh 0.1.2-rc.1 全链路，3080 只读复验）；报告 test/sandbox/verify.external-dsh-manage-012.report.html。UI 与 Windows 验收步骤交付用户（macOS 先验，Windows 用户机器实测补报告）
- 2026-09-06 合入（done -> closed）：dev-merge 合入 main（526e4e3），报告 13 项全过、人工审查通过；i18n 门禁修复（check-i18n.sh 正则剥离关键字识别）一并合入。Windows 实测步骤待用户机器补报告。

## 发送失败时消息被吞：应把文本+图片+文件还原回输入框

slug: failed-send-restore-composer

- 2026-09-13 记录 → open，用户明确要求修复，立即认领 → doing
- 2026-09-13 开发完成，自测通过（typecheck + 328 test + build，done 标记 efb5fd3）→ done
- 2026-09-13 主线合入（merge 494ab8d），用户 dev-ui-test 验收通过 → closed

## dsh-one 把 fork 出来的会话当成子代理（dsh web 不这样）

slug: fork-grouped-as-subagent

- 2026-09-01 记录问题，核实根因 → open
- 2026-09-01 认领（worktree: agent/fork-grouped-as-subagent）→ doing
- 2026-09-01 开发完成：三处判定收紧为 origin === "subagent"，普通 fork 不再被视为子代理（自测通过）→ done
- 2026-09-01 主线合入测试通过（merge 52a7d60），人工验收通过 → closed

## fork 运行中会话的限制与不一致（可 fork 的判定待讨论）

slug: fork-running-session-policy

- 2026-09-01 记录 → open（想法：未确认，已委派探索核实根因）
- 2026-09-01 探索完成：根因确认（判定=有无已完成轮次，非 running），方案方向列出 → 待讨论
- **fork 不被拒绝**（父 turn 已收尾，有切点），副本是**干净的历史快照**，与正在跑的子代理**零关联**：
- **信息不对称（待讨论）**：副本聊天流里可见那条 subagent 调用卡（历史记录里有），但「N 个子代理」chip/面包屑/会话树**都不认它**（血缘挂在原父下）；点击调用卡不会跳到仍在跑的子代理。官方 dsh web 行为一致（同一套 fork，无特殊处理）。
- 待实测确认：dsh-one 部署的子代理默认模式（后台 vs 前台）未实跑证实（代码推演默认 backgroundMode one-shot / run_in_background ?? continuable）；副本里调用卡的实际 UI 渲染未跑 UI 实测。
- 2026-09-01 认领（worktree: agent/fork-policy-ui）→ doing
- 2026-09-01 开发完成（worktree: agent/fork-policy-ui）。改动 1：列表「分叉会话」在
- 2026-09-01 主线合入测试通过（merge 41ce590），人工验收通过 → closed

## 前端共享基座建设 + 侧栏会话列表保活对账改造

slug: frontend-shared-foundation-sessions-keepalive

- （无变更记录）

## goal 模式条幅缺失；与排队/插话/todo 条幅的共存冲突待确认

slug: goal-mode-banner

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-02 开发完成，自测通过（typecheck + 253 测试 + build 全绿）→ done
- 2026-09-02 同步主线最新代码（rebase 到最新 main，+98 提交：plan-mode-chip/mention-chips/message-turn-timing 等）；冲突 3 处（chatSession.ts 基线+帧投影处理、webview.ts import+保活区、scenarios.js 基线清单）均已解决；重测 typecheck + 253 测试 + build + 22 项 goal DOM 断言 + 5 场景基线抽查全绿；条目随合入到主线。
- 2026-09-02 主线合入（rebase 后复测 typecheck + 317 测试 + build 全绿，--no-ff merge e2ae78d），人工 GUI 验收通过 → closed
- 2026-09-02 端到端验证（rebase 后独立验收）：typecheck + 317 测试 + build 全绿；6 个 goal 场景 DOM 断言全过（active 暂停/编辑/清除、paused 恢复/编辑/清除、blocked 受阻原因 title + 仅编辑/清除、complete 不渲染、叠放顺序 todo→goal→queue、编辑态预填+自动聚焦+保存可用）；`ui-visual.sh` 全量 66 场景回归，goal 6 张截图与自测轮逐像素一致（唯一重复对 goal-complete/model-picker 属预期：complete 不渲染与无 goal 页面相同）；真实 dsh 0.1.1-rc.2 RPC 契约探测：goals/pause|resume|edit|clear 方法均存在，CAS 假 ref 被安全拒绝（no current goal，无副作用）。验证期间发现 scenarios.js 多余右括号由 e5e3869 修复（与本验证重复修复，无残留）。

## harness 样式合流：chat 裸 .empty 规则泄漏到 sessions 空组头

slug: harness-style-merge-empty-collision

- 提出并定位（multi-select-exit-and-bar-wrap 任务中实测发现，确认为 harness-only artifact）。
- 2026-09-06 关闭（open -> closed）：建议方案 1 随 chat-column-layout 合入落地（gen-ui-harness.mjs

## header jobs 弹层交互微调对齐官方

slug: header-jobs-interaction-polish

- 2026-09-01 认领（worktree: agent/header-jobs-interaction-polish）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed

## 空态 hero 品牌区与发送按钮对齐官方（去掉标题）

slug: hero-brand-lockup-and-send-button

- 2026-09-02 记录 → open（想法：未确认，x 分隔符语义已向用户确认）
- 2026-09-02 用户补充：发送按钮改动覆盖非空白对话（普通消息流态），与官方交互一致（运行中主按钮变停止、取消独立停止按钮）；官方 InputBar 主按钮细节已核实
- 2026-09-02 认领（worktree: agent/hero-brand-lockup-and-send-button）→ doing
- 2026-09-02 主线 dev-merge.sh 合入（rebase 到最新 main，typecheck/334 测试通过，dist 重建）；基线冒烟 31 场景截图正常 → closed

## hero 空态 FishLogo 游动动画

slug: hero-fish-logo-animation

- （无变更记录）

## i18n：manifest 层（package.nls）

slug: i18n-manifest

- （无变更记录）

## i18n 合入门禁：每个合入主线的分支检查是否需更新 i18n

slug: i18n-merge-gate

- 2026-09-02 记录（用户要求：合入门禁，每分支检查是否需更新 i18n）→ open
- 2026-09-02 用户补充：README 层也要检查（功能讲解里可能遗留中文，要与 i18n 一致）
- 2026-09-02 定稿：文档层只查对外 README（README.md / README.zh-CN.md），不查 docs/；实现后置（后续单独认领开发），本次仅记录条目
- `i18n-webview`(webview 层文案表落地后,门禁的 webview 检查才有明确对账对象)
- `i18n-runtime` / `i18n-manifest`(已完成,对照逻辑已定)
- `scripts/dev-merge.sh`(校验阶段)
- `scripts/check-i18n.sh`(新增)
- 2026-09-02 认领（Sprint 1 节点，worktree: agent/i18n-merge-gate）→ doing
- 2026-09-02 实现：新增 `scripts/check-i18n.sh` 并接入 `dev-merge.sh` 校验阶段（done 标记校验后、rebase 前）。只查「相对 merge-base 新增的行」，不扫整分支历史；覆盖 宿主层/ webview层 / manifest层 / 对外README / 硬编码中文 五类检查；硬编码中文命中即 fail（先报错，未降级）；脚本可单跑 `scripts/check-i18n.sh <branch>`，exit 0/1 → done
- 2026-09-02 主线合入测试通过，人工 dev-ui-test 窗口验收通过 → closed

## i18n：运行时层（l10n）

slug: i18n-runtime

- （无变更记录）

## i18n：webview 层（把 locale 送进 webview）

slug: i18n-webview

- 2026-09-01 记录 → open
- 2026-09-02 补充核实（201 处中文字面量、bundle 现状、注入点），范围调整为「通道 + 基础设施 + webview.ts 存量替换」→ 认领 → doing
- 2026-09-02 开发完成，自测通过（typecheck + 336 test + build）→ done
- 2026-09-02 用户 visual 验收发现侧栏漏翻：补做侧栏 sessionsWebview 通道 + pure 模块共享文案（ac1b952），复跑自测 → done
- 2026-09-02 主线合入（f7cabef），人工验收通过（中文/英文环境侧栏均符合预期）→ closed
- 基础设施：`chatHtml` 注入 `window.__DSH_L10N__`（CSP nonce 内联，JSON 转义 `</`）；宿主 `loadWebviewL10n` 按 `vscode.env.language` 读 `l10n/bundle.l10n.<locale>.json`（en 不注入）；webview 加模块级 `t()`（key=英文默认串，支持 `{0}`/`{name}` 占位，缺 key 回退 key 本身）。
- 存量替换：webview.ts 201 处中文字面量 → 186 个 `t()` key（含 27 处插值模板）；两个依赖中文 title 的 CSS 选择器（权限模式/模型 pill）改 `data-role` 定位。
- `l10n/bundle.l10n.json` + `zh-cn.json` 补 185 个 key（zh/en 对齐，占位符一致，任务清单校验通过）。
- **侧栏补全（ac1b952，用户 visual 验收发现）**：sessionsView/sessionsHtml 加 l10n 注入通道（`loadWebviewL10n` 移到 chatViewHtml 共享）；sessionsWebview.ts 43 处中文改 `t()`；pure 模块共享文案支持注入 t（sessionTree/workflowRun/activityTree/sessionStats/agentPreset），宿主调用点传 `vscode.l10n.t`、webview 传内联 `t`；ui/webview.ts 状态页改 `vscode.l10n.t`；bundle 补 65 个 key。`i18n-pure-modules` 条目内容已在本次覆盖，无需再单独开发。

## 图片附件改为文件方式（落盘工作区 + 路径引用）

slug: image-attachment-file-mode

- （无变更记录）

## 流式刷新打断输入：全量输入点保活覆盖缺口

slug: input-keepalive-coverage-gaps

- 2026-09-06 用户报告改名输入与 question「其他」输入被流式刷新打断 → 核实：
- 2026-09-06 全量 review 两个 webview 的全部输入点（14 处）：新增发现 queue
- 2026-09-06 认领（worktree: agent/input-keepalive）→ doing
- 2026-09-06 开发完成，自测通过 → done（worktree: agent/input-keepalive，done 标记 6bca311；测试报告 test/sandbox/verify.input-keepalive.report.html）
- 2026-09-06 主线合入（merge 43424a6），复测 579 单测全绿 + 主线 harness 冒烟 3/3（rename/composer/question-other 流式保活）通过，人工确认 → closed

## 中文界面下头部后台任务 chip 显示英文（jobsChipLabel 漏传 t）

slug: jobs-chip-label-en-in-zh-locale

- 2026-09-03 用户反馈中文界面后台运行 job 没翻译 → 核实根因（webview.ts:2658 调 jobsChipLabel 未传 t，走 enFallback；zh bundle 译文存在）→ 记入 open/（未开始修改）。
- 2026-09-04 认领（open → doing）：按条目方案实施——webview.ts 的 jobsChipLabel 调用补传 t（实际行号 :2771，条目中 :2658 已漂移），中英文沙盒验证。
- 2026-09-04 开发完成（doing → done，agent/i18n-polish）：webview.ts:2771（条目原文 :2658 已漂移）jobsChipLabel 补传 t；自测全绿（typecheck + 386 tests + build，check-i18n.sh 通过）；测试报告 test/sandbox/verify.i18n-polish.report.html——沙盒 code-server 无 zh nls 切不出中文界面（argv.json/--locale/浏览器语言均实测无效），zh 项用 webview harness 注入真实 zh bundle 验证，并 A/B 对照修复前同场景显示英文「1 background jobs running」；另注：check-i18n.sh 查不出漏传 t（只查 key 是否入 bundle），本条只能靠测试/人工发现。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 后台任务展示改造成 dsh web 风格卡片

slug: jobs-inline-bar-vs-head-chip

- 2026-08-31 认领 → doing
- 2026-08-31 开发完成，自测通过 → done（删除横条，已合入）
- 2026-08-31 方向调整：改做 dsh web 风格卡片 → open
- 2026-09-01 关闭：经研究，该方向（后台任务卡片）实际拆成 4 个更具体的独立条目——`workflow-run-card`（workflow 运行卡）、`todo-panel-card`（任务清单卡）、`todo-write-call-card`（消息内 todo 卡）、`header-jobs-interaction-polish`（header 弹层微调）。本条目作为总纲已无独立内容，避免与 4 个条目重复，关闭。→ closed

## JSON 输出 JsonTree 逐节点展开

slug: json-output-tree

- （无变更记录）

## 发布到 VS Code Marketplace

slug: marketplace-publish

- （无变更记录）

## mention 绑定生命周期：按会话归档 + 边界校验 + recall 反查

slug: mention-bindings-lifecycle

- 2026-09-08 开发完成（worktree mention-bindings）：① mentionBindings 按会话归档/恢复（webview 模块级 → mentionBindingsPerSession，切换时归档旧会话、新会话空 Map、发送成功/失败不清空——绑定随草稿生命周期走），消除跨会话同名的强制 ` (2)` 后缀与 token 唯一性污染；② 展开前边界校验复用前置 tokenScan（boundTokenRanges/scanAtTokens，词中/邮箱不替换，未另写扫描）；③ restoreFileMentionTokens 反查优先（canonical → 原短 token，与发送展开互逆；↑ 召回历史时换回显示 token）。发送即消费未做（按拍板否决）。自测：typecheck/build 通过、单测 425 全绿（本轮新增 2 项反查优先用例）；测试报告 test/sandbox/verify.mention-bindings-lifecycle.report.html（F-01/F-02 新增 + R-01/R-02/R-03 回归全 pass，前两项为 harness 确定性场景 + DOM 断言，R-03 为沙盒真 dsh 端到端）→ doing → done
- 2026-09-08 认领：开发 session 开工（worktree mention-bindings）
- 2026-09-08 代码评审（4 角度子代理）确认后建条目 → open
- 2026-09-04 主 session 拍板：选 B 按会话归档（含 recall 反查 + 展开前边界校验），发送即消费否决；补「前置：paste-token-parsing-boundaries」→ 条目更新（仍 open/，排在其前置之后开发）
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 用户气泡引用 chips：仅 @session，无 @file/@folder 装饰

slug: mention-chips-files-folders

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-05 开发完成，自测通过（typecheck + 267 测试 + build 全绿），视觉场景 DOM 核对通过 → done（worktree: agent/mention-chips-files-folders）
- 2026-09-05 主线合入（dev-merge，rebase 解决 scenarios.js 基线列表冲突），合入后复测通过（317 测试全绿）+ mention-chips 视觉场景抽查通过，人工窗口验收通过 → closed

## 合入 gate 改为测试报告审查（流程变更）

slug: merge-gate-test-report

- 2026-09-04 方案确认后记录进 open/。状态变更（skill/AGENTS 改写）待单独认领。
- 2026-09-04 认领（open → doing）：按条目方案实施——SKILL.md/AGENTS.md 改写合入门禁为测试报告审查，test/sandbox 工具缺口补齐。
- 2026-09-04 开发完成（doing → done）：前置 sandbox-testing-chain 已交付（report.mjs/verify-driver.mjs/ledger 模板），按方案改写 `.agents/skills/worktree-dev-flow/SKILL.md`（流程 4 视觉自测降为开发自测、新增流程 5「生成测试报告」：任务专属 ledger → verify-driver 写回结果 → report.mjs 渲染 HTML，new-feature 在前 regression 在后，每项期望/截图/结论；合入门禁 = 人审报告，流程 6 dev-ui-test 仅疑问兜底）与 `AGENTS.md`（主线职责/合入门禁描述）；`test/sandbox/README.md` 补 report.mjs 用法与任务报告流程（场景模板/结果确认）；`.gitignore` 忽略报告 HTML。自测 typecheck + 386 test + build 全绿；report.mjs 端到端冒烟（verify-driver 跑 F-01 写回 done+screenshot → report.mjs 渲染内嵌截图/待判定/通过徽章）通过；done 标记 e44f754。本任务为文档/流程变更，无 UI 行为变化，按约定不建沙盒 ledger（报告工具链已实测）。
- 2026-09-04 补漏：`docs/development.md` 的「逻辑 bug」节原写「人工 dev-ui-test 窗口，见 skill 的人工门禁环节」，已对齐新门禁（开发自测 = ai-visual-validation / 沙盒场景驱动；合入验收 = dev-finish 测试报告人审；有疑问才人工开窗）。done 标记随重跑 dev-finish 更新到 732a8e3。
- 2026-09-04 主线合入（merge 1f9e53b，dev-merge 复测 typecheck/386 test/build 全绿，dist 已重建），用户指示合入 → closed。

## 消息气泡右键菜单：复制

slug: message-context-menu

- 2026-09-04 需求提出（用户：气泡右键直接复制，及「最后一条对话可编辑重做」——编辑部分后续被砍，见下条）；核实现状（无消息级右键菜单、复制仅 assistant 操作栏纯文本、dsh 无消息替换 API）。
- 2026-09-04 复制部分拍板（两项菜单恒显示 / user=images+files、assistant 含 producedFiles / 多图全写 + 路径文本兜底 / 文件用 markdown 引用）。
- 2026-09-04 用户决定**砍掉编辑相关功能**（编辑重发 / 分支重做，含此前讨论过的 E1 追加 / E2 分支方案与交互原型 `.dev-host/msg-menu-proto.html`），本条目只保留复制；「复制文字和附件」的剪贴板写入细节（多项目、路径兜底）不受影响。
- 2026-09-04 认领（dev session，worktree agent/message-context-menu）：按已拍板方案开发消息级右键复制（仅复制，无编辑）；开发中。
- 2026-09-04 开发完成（dev session，worktree agent/message-context-menu，commit bc6399b）：消息级右键菜单两项（复制文字 / 复制文字和附件）落地；user=images+files（含行内 @文件引用）、assistant=producedFiles 算附件；图片真实字节进剪贴板（多图受 Chromium 单 ClipboardItem 限制只能写首张，全部路径以文本兜底）、文件用 [文件名](路径) markdown 引用；纯 webview 本地动作，无新 webview↔host 消息。自测全绿（typecheck/build/test 425）+ 测试报告已产出（test/sandbox/verify.message-context-menu.report.html，F-01~F-04 + R-01~R-03 全 pass）。待主线合入。
- 2026-09-04 范围简化（用户拍板，dev session）：右键菜单砍到只留一项「复制」，复制纯文本（user 取 text / assistant 取 assistantText）；附件（图片/文件）不参与复制，「复制文字和附件」选项及图片二进制机制整体移除。原因：@label 等文本经剪贴板贴回输入框会被按形态推断成文件引用，用户决定最简做法。commit 363c112，自测全绿。
- 2026-09-04 主线合入后人工确认（用户实测通过，简化版单选项复制）→ closed

## 发送后消息图片附件不再显示缩略图（增量更新后占位/文件框不变）

slug: message-image-thumb-stale-after-incremental

- 2026-09-05 用户反馈（消息图片不显示缩略图）→ 代码链路排查 + 视觉验证复现（msg-menu-user 占位/文件框）→ 定位 dcdd1ca 增量更新签名未含缓存态 → 建条目（open/，未改代码）
- 2026-09-06 认领（worktree: agent/message-image-thumb-stale）→ doing；再次分析核实：根因确认（webview.ts:5199 行签名 `JSON.stringify(m)`，attachmentData:1404/fileThumb:1375/fileThumbFailed:1379 回执只写 attachmentCache/fileThumbCache/fileThumbRequested 后 render()，不改消息数据）；影响路径全部核实：消息 images 占位（messageImageThumb:4315，attachmentCache 未命中）、消息 files 图片文件框（fileChip:4359，fileThumbCache 未命中）、行内 @ 引用提升（renderMessage:4886 mergedAttachments(inlineFileRefs, m.files) 同源）、steering 气泡（renderSteeringItem:4281 同款渲染，flowSteerSigs:5251 同机制）；composer 挂起附件（pendingFileChip:6897）走 previewData 不依赖 fileThumbCache 懒路径，不属本条目范围
- 2026-09-10 开发完成（worktree: agent/message-image-thumb-stale）：行签名并入懒加载缓存态（lazyThumbSig：attachmentCache/fileThumbCache 命中态逐项编码，输入与 inlineFileRefs/mergedAttachments 渲染路径同源），buildFlowItems 对 user 非 context 消息与 steering 项签名追加缓存态 → 回执后该行重建一次换真图，缓存稳定后签名稳定行保活；fileThumbFailed 不改渲染输出不触发重建。验收：thumb-ack-after-incremental 场景（no-ack/acked/re-snap-stable 三态 + ACK-REBUILD-ONCE:OK 探针）进基线；R：msg-menu-user/attachment-uniform/file-ref-bubble/steering-pending + 沙盒 mock-llm 回显全 pass；mutation-driver AB 对照（改前 vs 改后 14 帧流式泵入逐帧变更量/finalTextHash 完全一致，流式保活零回归）
- 2026-09-10 dev-finish 通过（typecheck + 614 tests + build，done tag 37e9486）→ doing → done（worktree: agent/message-image-thumb-stale）；合入由主线执行
- 2026-09-06 认领（worktree: agent/message-image-thumb-stale）→ doing；核实根因与影响路径（见下）
- 2026-09-10 主线合入测试通过（merge 09a705c 合入；主线回归 typecheck + 620 tests + build 通过，thumb-ack-after-incremental 三态抽查含 ACK-REBUILD-ONCE:OK 角标复验）→ 人工确认 → closed

## 消息级计时指标缺失（ranFor / ttft / tps）

slug: message-turn-timing-metrics

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 人工 dev-ui-test 验收通过，主线合入测试通过 → closed

## mock 首轮注入适配与沙盒 workspace 路径清理

slug: mock-first-turn-injection-and-workspace-paths

- 2026-09-04 由 Playwright 驱动实测发现，核实为 mock/沙盒适配问题（非 dsh、非扩展 bug），记录进 open/。
- 2026-09-04 认领（open → doing）：修复随 sandbox-testing-chain 分支完成（注入判别两类 + storages 清理 + 驱动去暖场，实测 2/2 done）；分支合入验证后转 done。
- 2026-09-04 修复随 sandbox-testing-chain 合入（merge f0b8d28）并复测通过，doing → done。
- 2026-09-04 主线合入（f0b8d28）并人工确认 → closed

## 模型推理等级 UI 与官方 web 完全对齐：Default 档 + 去掉 description

slug: model-effort-default-align

- 2026-09-06 用户反馈（「dsh 官方 web ui 选择模型思考强度的时候有个 default」+ 确认是 Kimi）：建条目（open/）
- 2026-09-06 用户确认目标（「我们和官方完全对齐就行了」+「不需要显示description」）：认领 → doing/
- 2026-09-06 开发完成（worktree agent/model-effort-default，自测通过 + done 标记）：webview 菜单加 Default 档（无 defaultEffort 时）/切模型重置为默认档/菜单去 description、modelLabelOf 补 Default 后缀；新增 model-picker-effort-default 视觉场景进基线；测试 591 全过；报告 test/sandbox/verify.model-effort-default.report.html（7 项 pass，待主线人工审查后合入）
- 2026-09-06 主线合入通过：dev-merge 复测 591 测试全过 + dist 重建；用户人工 dev-ui-test 验收通过（Kimi 形态 Default 档/去 description 正常）→ closed

## 模型选择器差异：菜单内容与 trigger 形态（局部缺失）

slug: model-menu-polish

- 2026-09-01 记录 → open
- 2026-09-01 评审：待定（用户标注「就是这个样子，再核实一下」）；已核实 trigger 对齐、菜单描述/Retry/阻塞文案仍缺，待用户拍板是否补齐
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 test + build）→ done
- 2026-09-02 主线合入（74e1eed，功能提交 rebase 后为 07258e6）并人工确认 → closed
- ① 模型列表描述：`menuItem` 加 `sub` 选项（名称 + 描述两行，新增 `.menu-item.has-desc` / `.menu-item-main` / `.menu-item-desc` 样式），`renderModelMenuModels` 传 `m.description`（数据链路原有，未动）。
- ② loading/error/Retry：`sendModelCatalog`（chatView.ts）失败不再 `showErrorMessage`，改发新消息 `modelCatalogError`；webview 无旧目录时菜单显示「模型列表加载失败」+「重试」行（重试重发 `requestModels`），有旧目录保留旧数据不打断；`openModelMenu` 打开时重置失败标志。
- ③ 模型不可用阻塞文案：`ChatState` 加 `modelAvailable`（chatSession 存 `session.models.routable`，拉取失败保持 true 不误报）；false 时输入框 disabled + placeholder「当前模型不可用，请先选择模型」，发送按钮同样禁用，模型 pill 保持可点以便重选。

## 模型 pill 打开会话时先闪「选择模型」再切到真实模型

slug: model-pill-first-frame-flicker

- （无变更记录）

## 模型位显示「选择模型」占位 + 权限 label 未本地化（0.1.2 对齐官方）

slug: model-selector-012

- 2026-09-05 用户反馈（0.1.2 升级后模型位「选择模型」占位 + 权限英文；官方 dsh web 对照正常）→ 代码初步定位 → 建条目（open/，待实测确认根因）
- 2026-09-05 认领（open → doing）：主线派发开发 session 修复 model-selector-012；先本机 0.1.2-rc.1 实测 session/models（session/modelCatalog）与 session.list 投影 modelSelection 真实结构、确认模型位占位与权限 label 英文根因，再按实测结果修解析/标签本地化。
- 2026-09-05 开发完成（doing → done，agent/model-selector-012 @e4e53c6）：实测根因①0.1.2 下 session.list 投影 modelSelection 是 {lastUsed,next} 双层形状（blank 会话两边 null），旧解析整体 cast 成 SessionModelSelection，current.provider/model 均 undefined → modelLabelOf 拿不到 label → 「选择模型」占位（官方 web 取法 next ?? catalog.default，dshClientUiModelSelection syncInputs）；②permissions 投影 options.name 服务端一律英文机器名（workspace-write），无 locale 协商，官方 web 中文是客户端映射（dshClientUiPermissionPresets displayPermissionPreset）。修复：sessionModels 0.1.2 分支 current = next ?? lastUsed ?? catalog.default（activeModelSelection 防御畸形值，legacy 分支不动）；权限 label 照官方判定做本地映射（新纯模块 permissionLabel.ts：机器名/英文 product label 命中内置 preset 过 vscode.l10n.t，未知 Title Case 透传；zh bundle 补 仅可查看/工作区内修改/完全权限，对齐官方命名）。自测：typecheck + 508 tests + build 全绿，check-i18n.sh 通过；新增单测（sessionModels 双层解析 2 组、permissionLabel 6 组）+ harness 2 场景（模型 pill 真名、权限菜单中文，截图通过）+ 基线 34 场景抽查 + 本机 0.1.2-rc.1 真机探针（模型位 label DeepSeek-V4-Flash-Vision-Exp Max、权限 zh 仅可查看/工作区内修改/完全权限）。测试报告：test/sandbox/verify.model-selector-012.report.html（沙盒为 0.1.1 协议无法触发 isModern 分支，0.1.2 数据链路用真机探针 + harness，人工开窗验收命令已交付用户）。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed

## 切回「之前用过的模型」仍显示「窗口未知」

slug: model-window-cache-persist

- （无变更记录）

## 多选操作后退出多选模式 + 操作条按钮折行修复

slug: multi-select-exit-and-bar-wrap

- 提出并核实根因，方案经用户确认（移入/归档都直接退多选 + 短文案方案）。
- 认领，开 worktree 开发。
- 开发完成：worktree agent/multi-select-exit-and-bar-wrap，done 标记 8471dc7；测试报告 test/sandbox/verify.multi-select-exit-and-bar-wrap.report.html（worktree 内，6 项全 pass），待主线审查合入。
- 主线合入（merge commit f7acd1f）复测通过（typecheck + 567 单测 + build + dist 重建），用户确认，闭环。

## chat 多会话同时打开（一个 session 一个 editor tab）

slug: multi-tab-chat-sessions

- （无变更记录）

## 多 VS Code 窗口无法收养 0.1.2 dsh（token 存单窗口 globalStorage）

slug: multi-window-adopt-012

- 2026-09-06 用户实测反馈（第二窗口无法收养）→ 代码核实（token 存单窗口 globalStorage；0.1.2 认证实例被判 occupied 换端口另起）→ 建条目（open/）
- 2026-09-05 开发 session 认领（open → doing，worktree: agent/multi-window-adopt-012）。
- 2026-09-05 开发完成（doing → done，worktree: agent/multi-window-adopt-012）：共享记录迁移到 ~/.dsh/dsh-owned.json（原子写 + mkdir 锁，旧 globalStorage 一次性迁移）；第二窗口读到记录 → probeToken 认证 → adopted:true 复用（不 kill，owner=第一窗口保持 kill 权）；0.1.1 无 token 路径不变。自动化覆盖 = 12 项新单测 + 本机 0.1.2-rc.1 真环境探针 + 全量 529 pass；真双窗口场景建议人工开窗验收（命令见交接说明，报告 test/sandbox/verify.multi-window-adopt-012.report.html）。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed

## 事件流断线重连的剩余缺口（jobs / host 两条订阅）

slug: mux-reconnect

- 2026-08-31 认领（worktree: agent/mux-reconnect）→ doing
- 2026-08-31 开发完成，自测通过 → done
- 2026-08-31 主线合入测试通过，人工确认 → closed

## 开源项目质量基线补强（发布后不阻塞）

slug: oss-quality-baseline

- （无变更记录）

## 工具输出 fold 时 4000 字符硬截断导致全文不可恢复

slug: output-full-text-restore

- （无变更记录）

## 粘贴长文本转文件 + @ 引用

slug: paste-long-text-as-attachment

- 2026-09-07 用户提出需求，核实现状后建条目 → open
- 2026-09-07 用户拍板方案：文件式 + `@` 引用，排除纯折叠占位符 → 仍 open
- 2026-09-03 认领（worktree: agent/image-attachment-file-mode，与 image-attachment-file-mode 同 worktree 一起做）→ doing
- 2026-09-03 开发完成，自测通过（350 用例/typecheck/build/i18n；手动 WebBridge 全链路验证）→ done
- 2026-09-04 主线合入（6b0c2c2）后人工确认通过 → closed

## @ token 解析边界：ASCII 标点/括号/词中匹配的完整性

slug: paste-token-parsing-boundaries

- 2026-09-04 方案细节与主 session 拍板：平衡规则、`.`/`,` 条件规则、`\p{So}` 入终止集、ASCII `(` 不入边界、ASCII `;!?:` 入终止集、本条目先于 mention-bindings → open（可开工）
- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-08 认领：开发 session 开工（worktree paste-token-boundaries）
- 2026-09-04 开发完成（worktree paste-token-boundaries）：统一 @token 扫描纯函数 src/pure/tokenScan.ts，渲染/输入侧消费；单测 413 全绿（8 个验收 case 逐条覆盖 + tokenScan 专项），typecheck/build 通过；测试报告 test/sandbox/verify.paste-token-boundaries.report.html（F-01/F-02 + R-01/R-02/R-03 全 pass，F-02 为 harness DOM 断言，paste-long-text harness 场景为主线既有环境限制、与本条目无关）→ doing → done
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 插话消息显示：去掉「等待插话」徽章，改为正常气泡 + 开头处理中圆圈

slug: pending-steering-circle

- 2026-09-02 记录 → open（用户口头需求；徽章即「小 clip」已确认；圆圈取气泡左侧同行形式，用户未另选）
- 2026-09-02 认领（worktree: agent/pending-steering-circle）→ doing
- 2026-09-02 开发完成（worktree 自测：typecheck/330 单测/构建/视觉场景 steering-pending 对照通过；done 标记 b6a0022）→ done
- 2026-09-02 用户验收反馈 ① 气泡没右对齐（row 布局下缺 justify-content，实测见左）；② 转圈随消息刷新不断重置（render 每帧全重建，CSS 动画归零）；③ 新需求：↑ 键首选撤销等待插话，内容（含附件）回填 composer 重新编辑。均已实现：右对齐补 justify-content: flex-end；steering 行按 id 跨帧复用（元素移动不重置动画）；新增 unsteer 消息（host 移除 + restoreDraft 回填文本/图片/文件，图片按 attachmentId 拉字节）。
- 2026-09-02 用户复测：节点复用方案仍刷新（实测移除再插入节点会让 CSS 动画重启动，之前假设错误）。改为相位续播（与 todo-in-progress-spinner-flicker 会话同机制）：renderSteeringItem 新建 spinner 时补负 animation-delay（performance.now()%900），新节点从旧节点相位继续转；实测三帧快照相位递进 -64.6ms → -95.7ms → -186ms。
- 2026-09-02 人工窗口验收通过；主线 dev-merge.sh 合入（rebase 到最新 main，334 测试通过，dist 重建）；主线 baseline 冒烟 31 场景截图正常 → closed

## Full access 权限切换无风险确认门

slug: permission-full-access-confirmation

- 2026-09-01 记录 → open
- 2026-09-01 评审核实：已有实现（VS Code 风险弹窗 chatView.ts:1505-1514），关闭（用户确认）

## 权限（preset）懒切换 pending 跨会话泄漏：在 A 会话点选，发送时落到 B 会话

slug: permission-pending-cross-session

- 2026-09-03 用户反馈：A 输出中切权限卡住，到 B 发消息时权限切换到 B 落地 → 代码核实完整链路（tab 复用不清 pending + 发送时落地到当前 tab 的 controller）→ 根因确认 → 记入 open/（未开始修改）。
- 2026-09-03 用户补充：切换发生在空白会话（hero）里，正常消息流对话没有权限切换（与 DSH web 一致）→ 复现链修正为「A 输出中新建空白会话（同 tab 替换）→ hero 里切权限 → 点回 A（同 tab 再替换）→ A 发送时落地到 A」，根因不变（pending 挂 tab、replaceWith 不清、发送时落地）。
- 2026-09-03 方案探讨（用户要求架构层面审视，不做最小改动）：定性——三个 pending 是「会话级软状态」却挂在 tab 的裸字段上，而 tab 跨会话复用（产品决策），属于**结构性错位**，补一行清理只是治标，后续新增同类状态还会再漏。参照系：webview 侧同类状态（草稿 composerDrafts、附件 stagedPerSession）已用「per-session Map 归档」范式处理，pending 是唯一没对齐的。方案对比：A 最小改（replaceWith 清字段，意图作废，且下次还会漏）；B 收拢为 SendIntent 对象 + replaceWith 整组作废（防漏但语义与草稿不一致）；C（推荐）per-session intent 归档（`Map<sessionId, SendIntent>`，换会话零处理、切回恢复、结构性不串台）+ 发送时原子快照消费（applySendIntent 收口，一并解决 workspace+permission 组合意图落在目标会话的问题）。
- 2026-09-03 用户拍板采用推荐方案 C，仅记录 backlog（未实施）；条目继续留在 open/，实施入口为「认领 → doing」。
- 2026-09-03 认领：worktree slug `permission-pending-cross-session`，按方案 C 实施（开发结果见条目完成时追加）。
- 2026-09-04 开发完成（slug `permission-pending-cross-session`，分支 agent/permission-pending-cross-session，HEAD 3e0c348）：chatTab.ts 三个 pending 裸字段 → `pendingIntentBySession: Map<sessionId, SendIntent>`（SendIntent = workspaceId/presetId/permission，含读 pendingIntentFor / 按域写 setPendingIntentField / 清 clearPendingIntent 三个 helper，tab 销毁随对象回收）；chatView.ts 三个 setPending* 改写当前会话条目、composeHeader 覆盖改从当前会话 intent 读、三个 resolvePending* 收口为 `applySendIntent(host)`（发送开始时快照当前 tab intent 并即清，按序执行：workspace 失败短路=提示+取消发送，preset/permission 失败只记日志；组合意图落点=切换后的目标会话）；chatMessages.ts send handler 调用收口接口；ChatTabHostActions 三个 set 保留、resolve 合成一个。自测：typecheck / test（386 通过）/ build 全绿；沙盒任务专属 ledger（test/sandbox/verify.permission-pending-cross-session.ledger.json + 渲染 report.html，报告 HTML 已 gitignore）发送链回归 R-01 通过（新建会话→发送→mock 回显命中、截图核对）。修复目标场景（tab 跨会话复用的 pending 串台）是宿主层行为——verify-driver 确定性链与 webview 独立渲染均覆盖不到，报告 coverageNote 已注明，留人工 dev-ui-test 验收；条目转 done/，待主线合入。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 置顶会话不能被归档（未来删除同样保护）

slug: pinned-not-archivable

- 2026-09-04 需求提出（用户：置顶标签页不能被归档，避免误归档/未来误删除）；已核实现状（归档仅禁运行中/未读/待处理、插件内无恢复入口、置顶 id 归档后残留）；确认方案（UI 置灰 + host 命令层兜底 + 未来删除同样保护）。未开始开发。
- 2026-09-04 回收站需求（`recycle-bin`）讨论确认：置顶同样不能移入回收站（清空 = 归档，入站会绕过保护），与归档共用 host 层防线。
- 2026-09-04 认领（worktree recycle-bin，与 recycle-bin 一起开发并共用 host 层防线）：开始开发。
- 2026-09-04 开发完成（与 recycle-bin 同 worktree，branch agent/recycle-bin，done tag 8294548）：归档路径全部封死——批量多选 sessionSelectable/sessionSelectTip 增加置顶条件（复选框置灰 + 悬停提示）；sessions 面板行菜单与 chat 头部 ⋯ 菜单「Archive session」两处加入置顶禁用（置灰 + 提示，优先级在 running/unread/pending 前）；extension.ts dshOne.session.archive/archiveMany 命令层兜底（单项命中警告返回、批量计入 failed 回传，两个 webview 菜单同走这两个命令一处兜底两端生效）；延伸（recycle-bin 并行落地）：置顶同样不能移入回收站（行菜单/多选禁用 + sessionsView host 层过滤并提示，同一条防线）。不强制取消置顶、不清理历史残留 id（按方案边界）。自测全绿（typecheck/build/test 429）；沙盒验收 F-07 场景 + 全量 E2E 断言 pass（verify.recycle-bin.report.html）。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 输入区 Plan 状态 chip 缺失（对齐 dsh web PlanChip）

slug: plan-mode-chip

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + test 253 + build），UI 人工验收方法见上 → done
- 2026-09-01 修复：/plan off 后 chip 未立即消失（composerSig 不含 plan，composer 保活不重建），已修复并重跑自测；人工 dev-ui-test 验收通过（测试 ok）→ done
- 2026-09-01 主线合入测试通过（dev-merge rebase 解决 webview.ts composerSig 冲突后合入，merge 4e1c773），人工验收通过 → closed

## 自绘弹出菜单点击 webview 外不关闭（session 右键菜单）

slug: popover-webview-outside-dismiss

- 2026-09-04 用户报侧栏 session 右键菜单点击编辑区不关闭；代码确认根因为关闭仅依赖 webview 文档内 mousedown，webview 外事件不可达；方案定为 window blur 失焦关闭，sessions + chat 两处同根因一起修。
- 2026-09-04 开发完成（worktree popover-webview-outside-dismiss，dev-finish 通过：typecheck/test 449 全过）：sessions 与 chat 两处 popover 打开时挂 window blur 监听、dispose 时移除，webview 失焦即关菜单。验收报告 `test/sandbox/verify.popover-webview-outside-dismiss.report.html`（沙盒真 VS Code 验证 F-01/R-01 + harness 验证 F-02/R-02/R-03，5 项全 pass）。待主线合入。
- 2026-09-04 主线合入后人工确认（用户确认合入）→ closed

## 会话头部 preset chip 消失：dsh 0.1.2 把 agentPreset 挪进了 projections

slug: preset-chip-projections-migration

- 2026-09-06 用户反馈 preset 显示消失（位置：会话头部只读 chip）→ 真机数据定位根因
- 2026-09-06 开发完成（doing -> done）：sessionAgentPreset 窄化（projections.values.agentPreset
- 2026-09-06 合入（done -> closed）：dev-merge 合入 main（复测 typecheck/568 单测/build 全过，dist 已重建）；用户主线 reload 实测通过（列居中对齐、jump pill、头部 preset chip 恢复）。

## 问题卡输入框：流式快照重建 DOM 导致焦点频繁丢失、输入中断

slug: question-card-input-focus

- 2026-09-02 核实并定位根因（浏览器实测复现），未改代码。
- 2026-09-02 认领（worktree：question-card-input-focus），开始修复。
- 2026-09-02 开发完成（worktree 7f94bf5）：pending 区接入保活策略，流式快照不重建焦点内的问题卡；单选点击改就地更新高亮。typecheck + 226 tests 全绿，harness + WebBridge 实测焦点保持。→ done
- 2026-09-02 主线合入（merge 50011e7）：typecheck + 231 tests 全绿，harness 抽查焦点保活通过（sameEl/focus/draft 均正常）。→ closed

## 多问题卡片第一页即可提交整组，后续问题被静默遗漏

slug: question-card-submit-on-first-page

- 2026-09-08 核实（现象属实：dsh-one 插件卡片；dsh web 已是建议行为）→ open
- 2026-09-08 认领（worktree: agent/question-card-paged-submit）→ doing
- 2026-09-08 开发完成，自测通过（typecheck + test 337 + build + check-i18n）→ done
- 2026-09-08 主线合入测试通过，人工确认 → closed

## 用户问答/审批位置与形态不同（web 是 composer 接管）

slug: question-flow-composer-form

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 tests + build 全绿；视觉场景 DOM 断言全过）→ done
- 2026-09-01 主线合入测试通过（merge d68101a，263 tests 全绿），人工 dev-ui-test 验收通过 → closed

## 问题卡单选：输入自定义回答时取消选项高亮 + 「其他」选项

slug: question-other-option

- 2026-09-05 提出（方案甲：输入取消高亮 + 「其他」选项）→ open
- 2026-09-05 认领（worktree: agent/question-other-option）→ doing
- 2026-09-05 开发完成，自测通过（typecheck/424 单测/build；视觉 harness 8 项全过，报告 test/sandbox/verify.question-other-option.report.html）→ done
- 2026-09-04 主线合入后人工确认（用户 dev-ui-test 验收通过）→ closed

## 问题弹窗：单选点击选项立即提交，缺明确确认步骤，易误触

slug: question-pending-confirm-step

- 2026-09-01 记录 → open
- 2026-09-01 认领 → doing
- 2026-09-01 开发完成，自测通过（typecheck 208 tests build + AI 视觉验证）→ done
- 2026-09-01 主线合入（merge 5d76941），复测通过（typecheck + 208 tests + build + 基线视觉冒烟），人工验收通过 → closed

## 0.1.2 下 ask_user_question 不再弹出问题卡（waterfall 链路缺口）

slug: question-waterfall-no-card

- 2026-09-05 用户实测反馈（0.1.2 下 ask_user_question 无问题卡，model-selector-012 会话实例截图）→ 关联 2A 已知缺口 → 建条目（open/）
- 2026-09-05 认领（open → doing）：实测协议与渲染定位中（worktree 待建）。
- 2026-09-05 开发完成（worktree: .worktrees/question-waterfall-no-card, branch agent/question-waterfall-no-card, commits 5ae61fd+33bae19）→ 摘要：根因实测定位——网关 $events 水瀑布帧只在水瀑布创建时向「当时已连接」的客户端各投递一次；扩展的 $events 单例连接早已存在，后建的 chatSession handler（用户开会话 tab）收不到挂起帧 → 会话在提问之后打开就不弹卡（实测：提问挂起 213s 期间开面板始终无卡，最终 ASK_ABORTED；真实报文 {type:waterfall, event:user-questions/request, eventId, agentId=sessionId, request.questions=[{id,question,options:[{label,description}]}]}）。
- 2026-09-05 开发完成（worktree question-waterfall-no-card，HEAD 33bae19）→ 主线合入后人工确认 → closed

## 排队消息在会话切换后丢失（晚订阅者收不到 control baseline）

slug: queue-lost-after-session-switch

- （无变更记录）

## 排队中卡片预览的 @ 引用原样上屏（长 URI/路径占满两行 clamp，正文被吞）

slug: queue-preview-mention-chips

- 2026-09-05 用户提出（排队中预览：除附件外其他 @ 情况也需渲染优化，询问意见）→ 核实现状（附件已剥行折叠、@ 引用原样上屏、steering 已走 chip 管线）→ 建条目（open/）
- 2026-09-05 用户确认直接修复 → 认领（worktree: agent/queue-preview-mention-chips）→ doing
- 2026-09-05 开发完成，自测通过（typecheck + 569 单测 + build；harness 视觉全量 143 场景 + 验收 ledger 报告 verify.queue-preview-mention-chips.report.html，F-01/02 新功能 + R-01~04 回归）→ done
- 2026-09-05 主线合入（de40b5a）；合入后复测 typecheck + 569 单测 + build 通过，harness 抽查 queue-preview-mention 场景与验收截图一致，人工确认 → closed

## README 补充内置安装脚本说明

slug: readme-install-script

- （无变更记录）

## README 面向使用者：去除内部开发信息

slug: readme-user-facing

- 2026-09-02 记录 → open
- 2026-09-02 记录 → open
- 2026-09-02 认领 → doing
- 2026-09-02 开发完成，自测通过（typecheck/336 test/build），done 标记 7b1d3ff → done
- 2026-09-02 主线合入（e6daf73），复测通过（typecheck/336 test/build）→ closed

## Windows 测试暴露：无 token 记录 + 认证实例进防护死循环（日志恢复自愈）

slug: recover-token-from-log

- 2026-09-05 用户 Windows rc.3 测试报障（防护死循环日志）→ SSH 实机排查（dsh-owned/进程/日志/时间线/spawnDsh 实测）→ 根因如上 → 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree recover-token-from-log）；实现如上；typecheck/567 单测全过 i18n 门禁通过
- 2026-09-05 开发完成（doing -> done）：分支 agent/recover-token-from-log；ledger test/sandbox/verify.recover-token-from-log.ledger.json（4 项全过）；Windows 真机验证步骤见条目覆盖说明（装 rc.4 → 清记录保实例 → reload 看自愈）。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（4eac9d9）；ledger 4 项全过、审查通过；Windows 自愈验证交用户（rc.4）。

## 无记录 + 认证实例时日志恢复 token（rc.4 漏掉的路径）

slug: recover-token-no-record

- 2026-09-05 用户报障（装了 rc.4 未自愈）→ SSH 复验现场确认（记录已清、实例活、日志有 token）→ 根因：恢复逻辑只在有记录分支 → 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree recover-token-no-record）；实现如上；typecheck/567 单测全过、i18n 门禁通过
- 2026-09-05 开发完成（doing -> done）：分支 agent/recover-token-no-record；ledger test/sandbox/verify.recover-token-no-record.ledger.json（4 项全过）；Windows 真机验证 = 当前现场（无记录+实例活+日志有 token）装 rc.5 看自愈。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（11d3c19）；ledger 4 项全过、审查通过；Windows 自愈验证交用户（rc.5）。

## 回收站交互调整：抽屉式半栏覆盖 + 清空图标放大

slug: recycle-bin-drawer

- 2026-09-05 用户实测反馈两点（整栏切换不符预期 / 清空图标太小，附截图）→ 建条目（open）
- 2026-09-05 认领（worktree recycle-bin-drawer）：开始开发。
- 2026-09-05 开发完成（worktree recycle-bin-drawer，branch agent/recycle-bin-drawer，done tag 98835dc）：两点落地——① 抽屉式半栏覆盖：点击「回收站 (N)」不再整栏切换，改为从侧栏底部滑出抽屉（默认 50% 高、无遮罩直接叠，主列表上半部仍可交互），收起 = 点击外部 / ‹ Back / Esc / 提手拖到下拉到底；提手（grab 横条）上拉可扩到 90%（两档吸附 50%/90%），面板内保留原有全部功能（按原 workspace 分组、组头计数+折叠、行菜单恢复/归档、恢复全部、清空 modal、置顶保护），行菜单/归档弹窗内的点击不触发「点击外部收起」。② 清空回收站图标按钮 24px → 32px（图标 16→18px），保留悬停提示。附带修复：harness scenarios.js 的 sessionsTree 缺回收站快照字段（recycle-bin 合入时遗留，导致基线场景渲染中断）→ 补齐并新增 sessions-recycle-drawer 场景；回收站入口空态修饰类 empty → is-empty（避开 chat 侧全局 .empty 样式冲突，仅 harness 合成样式受影响）。自测全绿（typecheck/test 449/build）；沙盒验收 ledger 全 pass（verify.recycle-bin-drawer.report.html，F-01..F-06 + R-01/R-02；E2E 尾段 webview 帧重建伪影已在 R-01 注明并以受控复现二验）。无 UI 行为变化以外的纯逻辑改动。
- 2026-09-05 人工 dev-ui-test 反馈两点，已在 worktree 修复（commit ee2e461 起，done tag 已移至 159187e）：① 「‹‹ 返回」双重箭头 → 单个 ▼ 下拉箭头（SVG 左箭头与 t('‹ Back') 译文自带「‹」重复；半栏抽屉方向也应为下拉），文本用新 i18n 键 Back（en/zh 均已补）。② 垃圾桶图标仍偏小、计数徽标位置不对（标题 flex:1 把计数挤到行尾与垃圾桶挨着）→ 图标 18→22px、按钮 32→34px（补 padding:0 + border-box），计数徽标收进标题内联组紧跟「回收站」文本。自测全绿（typecheck/test 449/build）；沙盒 E2E 重跑通过（F-05 34px/22px、F-05b 新增断言：单箭头 + 计数在标题组内），报告已重新渲染。
- 2026-09-04 主线合入后人工确认（用户 dev-ui-test 验收通过）→ closed

## 回收站状态持久化：新开窗口后分组分类失效

slug: recycle-bin-persistence

- 2026-09-05 用户实测反馈：新开窗口后回收站分类失效，要求像分组功能一样持久化 → 建条目（open/，待核实根因与迁移范围）
- 2026-09-05 认领：worktree 开发 session（slug recycle-bin-persistence）开工，先按条目要点核实根因与迁移范围。
- 2026-09-05 开发完成（doing → done）：分支 agent/recycle-bin-persistence，HEAD **6d1d18a**（done/recycle-bin-persistence tag），dev-finish 自测全绿（typecheck / build / **470 tests** / check-i18n）。**实现**：`sessions.recycleBin` + `sessions.recycleCollapsed` 迁 **globalState**（key 字符串不变，与分组 `sessions.groups` 等互不冲突；旧 workspaceState 同 key 仅作迁移源）；构造器一次性迁移——globalState 有值（哪怕空数组）即权威，否则回读旧值写回新 key，旧 key 一律删除（避免陈旧态复活）；移入/批量移入/恢复/恢复全部/归档清理/折叠全部改走 `persistRecycleBin`/`persistRecycleCollapsed`；清账改调纯层 `pruneRecycleIds`，**冷启动不清账保护保留**（基线未就绪早退）。新增纯层 `src/pure/recycleBinState.ts` + 单测 `test/recycleBinState.test.ts`（5 项：数据清洗/迁移决策/冷启动保护/清账）。**报告说明**：无 UI 行为变化（webview 渲染与交互不变，仅存储位置 + 一次性迁移），按流程 5f 不建沙盒 ledger；跨窗口/重载持久化语义由**单测 + 官方 Memento API**（workspaceState per-workspace / globalState 跨窗口 / update(key, undefined) 删键）保证，code-server 沙盒无法验证新窗口且 reload 不可靠；新窗口场景待用户 dev-ui-test 人工验收回执。
- 2026-09-05 主线合入后人工确认（用户确认合入）→ closed

## 回收站（软删除缓冲层）

slug: recycle-bin

- 2026-09-04 需求提出（用户：归档不可逆、无删除，做回收站作为中间缓冲层；清空回收站 = 归档全部）；已核实现状（dsh 无 session 删除、插件无 unarchive）并评估合理（方案 A/B/C 对比设计稿 `.dev-host/recycle-bin-mock-v1.png`）。
- 2026-09-04 用户拍板：方案 A（底部固定入口 → 独立回收站视图）；置顶不能移入回收站（与归档同规则）；运行中/未读/待处理可以移入；加「恢复全部」；接受本地状态局限。未开始开发。
- 2026-09-04 认领（worktree recycle-bin，与 pinned-not-archivable 一起开发并共用 host 层防线）：开始开发。
- 2026-09-04 开发完成（worktree recycle-bin，branch agent/recycle-bin，done tag 8294548）：方案 A 落地——底部固定入口「回收站 (N)」（0 灰态）→ 独立回收站视图（‹ 返回 + 标题 + 计数徽标 + 清空图标按钮 + 恢复全部；按原 workspace 分组，组头计数+折叠，折叠态独立持久化；软删 workspace 的会话自动归未分组；空态引导）；移入（行菜单 + 多选操作条，可逆、无确认弹窗、短提示；运行中/未读/待处理可移入）；恢复（单项行菜单 + 头部恢复全部）；清空/单个归档 = 复用 archiveMany 链路（confirm modal，说明归档后无法恢复/记录保留），成功后从本地集合清掉，dsh 侧归档的 id 下次刷新清理；置顶不能移入（复选框置灰 + 提示 + host 命令层兜底）；状态存 workspaceState sessions.recycleBin（dsh 无此概念，纯本地缓冲层）。自测全绿（typecheck/build/test 429）；沙盒验收 ledger 全 pass（verify.recycle-bin.report.html，F-01..F-08 + R-01/R-02，20 断言/24 截图；host 命令层兜底无法 UI 自动化，经代码审查覆盖）。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 回收站抽屉提手横条看似没用（点击无反应）

slug: recycle-drawer-handle-affordance

- 2026-09-06 用户实测反馈（抽屉顶部横条不知道有什么用）→ 核实代码：横条是纯拖动提手、点击无反应，交互不可发现 → 建条目（open/）
- 2026-09-06 认领（worktree: agent/recycle-drawer-polish）→ doing。用户拍板做法：**点横条 = 收起抽屉**（拖动扩/收逻辑保留），并加悬停提示。与 recycle-entry-quick-actions 同 worktree 开发。
- 2026-09-06 开发完成（worktree recycle-drawer-polish，branch agent/recycle-drawer-polish，done tag da68b6e）：按用户拍板落地——提手点击（<4px 抖动）= 收起抽屉，悬停提示「拖动调整高度，点击收起」（新 l10n 键 en/zh）；拖动扩大/下拉收起保留；setPointerCapture 加 try/catch 兜底（合成事件环境）。自测全绿（typecheck/test 588/build）；沙盒验收 ledger 全 pass（verify.recycle-drawer-polish.report.html，F-03/F-04 + R-01..R-03；F-04 drag-expand 帧背景透明为 harness 无主题变量既有 artifact，已在 notes 注明）。无 host 层改动。
- 2026-09-06 同 worktree 追加（用户反馈，与本条同批合入）：清空全部图标（抽屉头 + 入口行）改错误红（commit 834d610，.sessions-tool.danger），详见 recycle-entry-quick-actions 变更记录；本条的提手点击收起不受影响（R-01/F-04 回归照旧 pass）。
- 2026-09-06 主线合入测试通过（merge c0ebe15，复测 typecheck/test 588/build 全绿），人工确认（用户审报告后指示合入）→ closed

## 回收站入口行（抽屉收起态）加快捷操作：清空全部 / 恢复全部

slug: recycle-entry-quick-actions

- 2026-09-06 用户提出（抽屉收起态也想要清空全部/恢复全部快捷操作）→ 核实现状（入口行无快捷操作，只在抽屉头有）→ 建条目（open/）
- 2026-09-06 认领（worktree: agent/recycle-drawer-polish）→ doing。用户拍板做法：**方案 1——入口行右侧常驻两个图标按钮**（清空 + 恢复全部，计数 0 置灰，点击不触发打开抽屉）。与 recycle-drawer-handle-affordance 同 worktree 开发。
- 2026-09-06 开发完成（worktree recycle-drawer-polish，branch agent/recycle-drawer-polish，done tag da68b6e）：按方案 1 落地——入口行外层 button 改 div（button 不能嵌套），主区 .recycle-entry-main 点击开抽屉，右侧常驻清空（复用 openRecycleArchiveModal 确认链路）/恢复全部（sessionsRestoreAll）两个 .sessions-tool 图标按钮，计数 0 置灰；新增 harness 场景 sessions-recycle-entry-actions / sessions-recycle-handle 并进 BASELINE_SCENARIOS。自测全绿（typecheck/test 588/build）；沙盒验收 ledger 全 pass（verify.recycle-drawer-polish.report.html，F-01/F-02 + R-01..R-03）。
- 2026-09-06 用户追加反馈：清空全部图标（入口行快捷按钮 + 抽屉头）都改成红色 → 已在同 worktree 完成（commit 834d610）：两处清空按钮加 .sessions-tool.danger（color: --vscode-errorForeground），disabled（计数 0）回落灰色；ledger 增 F-05 专项并重渲报告（8 项全 pass），done tag 待随本次提交前移。
- 2026-09-06 主线合入测试通过（merge c0ebe15，复测 typecheck/test 588/build 全绿），人工确认（用户审报告后指示合入）→ closed

## 发布流程 skill（release-gate skill）

slug: release-flow-skill

- （无变更记录）

## 发布门禁（release-gate）

slug: release-gate

- （无变更记录）

## 发布三件套一致性（version + release note + tag）

slug: release-version-changelog-tag

- （无变更记录）

## 沙盒测试 docker build 触发 DSH 提权

slug: sandbox-build-escalation

- 2026-09-04 建条目：复现 buildx 写 ~/.docker 被拦，提出 BUILDX_CONFIG 重定向方案，已实测有效。
- 2026-09-04 开发完成：run-sandbox.sh build 内置 BUILDX_CONFIG=/tmp/dsh-sandbox-buildx，实测无提权构建成功；dev-finish 通过（typecheck/test 386/build）。无 UI 行为变化，沙盒报告不适用。
- 2026-09-04 主线合入（8e4a2db）后人工确认（用户告知，记为 Sprint 1G）→ closed

## 沙盒（test/sandbox）不支持并行实例：两个 session 同时做容器验证会互相干扰

slug: sandbox-parallel-instance

- （无变更记录）

## Docker 沙盒测试/截图环境（spike 已验证，待产品化）

slug: sandbox-testing-chain

- 2026-09-03 spike 验证通过后记录进 open/，方案已经 session 内确认。
- 2026-09-03 认领开发（open → doing）：docker 沙盒脚本化 + mock dsh server。
- 2026-09-03 开发完成（doing → done）：test/sandbox 脚本化（Dockerfile/entrypoint/run-sandbox.sh/README）+ test/mock-dsh 零依赖 mock（server/scenario/单测 13 条）。自测：typecheck + npm test 352 全过 + build 通过，done 标记 d1df06a。待主线合入后做 docker/真窗口验收。
- 2026-09-03 追加方案（done → doing）：不做协议层 mock 的全量验证，主路径改为「真 dsh + mock LLM 端点」——dsh 的 llm-pi-ai provider 原生支持 baseURL（schema 有 baseURL/api 字段，已核实 0.1.1-rc.2 源码），零 patch；协议层 mock（test/mock-dsh）保留为快速单测工具。新增 test/mock-llm（OpenAI 兼容假端点）+ 沙盒接线（--mock-llm 模式）。
- 2026-09-03 mock-LLM 端点与沙盒接线开发完成（doing → done）：test/mock-llm（零依赖 OpenAI 兼容端点 + 15 条单测）、test/sandbox --mock-llm 模式（容器内真 dsh 打假端点）。自测：typecheck + npm test 368 全过 + build 通过。待主线合入后 docker/真窗口验收。
- 2026-09-04 追加（done → doing）：合入报告 gate 落地——新增 test/sandbox/report.mjs（ledger+截图→HTML 报告）与 Playwright 驱动（CI 用，本地仍 WebBridge）；配套场景/ledger 格式定义。
- 2026-09-04 全部完成（doing → done）：test/sandbox/report.mjs（ledger→单文件 HTML 报告）+ verify-driver.mjs（Playwright 自动驱动，实测 F-01/R-01 done）+ playwright devDep。自测 typecheck + 368 测试 + build 通过。合入 gate 流程变更见 backlog open/merge-gate-test-report.md（待单独认领）。
- 2026-09-04 改进（done → doing）：修复 mock 首轮注入匹配 + 沙盒 workspace 宿主路径清理（同分支未合，一起收口）。
- 2026-09-04 收口完成（doing → done）：注入判别扩为两类（<system-reminder> 标签 + 无标签 Current runtime context 快照），mock 模式清 storages 注册表（EACCES 消除），驱动去暖场。实测 F-01/R-01 首轮直接命中 2/2 done，截图确认侧边栏无宿主残留。自测 369 测试全过。
- 2026-09-04 合入通过（done → closed）：merge f0b8d28，主线复测 typecheck + 370 测试全过，人工确认报告并同意合入。

## 整理截图目录并补 README 截图

slug: screenshot-organize-readme

- （无变更记录）

## 贴底后触控板惯性下滑：视图反复回弹抖动（非必现）

slug: scroll-bottom-momentum-jitter

- 2026-09-01 记录问题，核实代码路径（写路径 4 处、合入前后对比）→ open
- 2026-09-01 网上调研，方案候选按规范做法重写（防线层 CSS + 行为层意图门控 + microtask 重锚定）
- 2026-09-01 用户确认：仅流式输出期间抖动；输出完成后不抖（坐实「写帧窗口 = 渲染推送窗口」）
- 2026-09-01 认领（worktree: agent/scroll-bottom-momentum-jitter）→ doing
- 2026-09-01 完成开发（worktree: agent/scroll-bottom-momentum-jitter）：防线层 `.messages { overscroll-behavior-y: none }`（判定弹性作用在 `.messages`——页面唯一滚动容器，`html/body/#app` 均 `height:100%` 且不设 `overflow`，不参与滚动链）+ 行为层意图门控（render 滚底与 `repinIfFollowing` 在 `userScrollIntentActive` 时跳过，不抢原生惯性动画）+ render 滚底改 microtask 重锚定写 settle 值（`shouldPinNow` 纯函数）；自测 typecheck / test(209) / build 全绿，baseline 15 场景 + 流式推送×意图窗口动态检查通过；惯性碰撞机制本身需真实触控板人工确认 → done
- 2026-09-01 迭代 2（人工验收反馈后补）：① 根层回弹——`.messages` 的 `none` 盖不住 webview 根文档（html/body 页面级）回弹，`overscroll-behavior-y: none` 补到 `html, body`（`.messages` 上保留）；② settle 恢复 pin——动量末尾视口脱底 + 流式无后续 render 时悬空，`noteUserScrollIntent` 加意图过期后一次性定时器 + scroll 监听加同步 settle-restore（都用 `shouldPinNow`），兜住「输出刚好在动量结束时停止」的恢复空洞；自测全绿，动态检查（意图窗口内 microtask 跳过 + settle 定时器恢复回底）通过 → done
- 2026-09-01 迭代 3（人工验收决定性问题后重做）：确认碰撞不在「意图过期就写」而在「写的时候滚动还在动」——迭代 2 的 scroll 监听同步 settle-restore 与固定 +30ms 定时器会在弹性回归动画中途写 scrollTop（回归阶段通常比最后一个 wheel 晚 200ms+，意图已过期），打断动画→再弹→再被打断→连续碰撞。统一改为**滚动空闲判定**：维护 `lastScrollActivityAt` + `SETTLE_IDLE_MS(120ms)` debounce（每次 wheel/scroll/pointerdown 滚动活动重排），到期跑 maybeSettlePin（`shouldSettlePinNow` = shouldPinNow && !scrollActiveRecent）——回归动画期间 debounce 被反复推迟，动画真正结束才可能写；删掉迭代 2 的同步 settle-restore 与固定 +30ms 定时器；repinIfFollowing 与 render 尾 microtask 同走 shouldSettlePinNow 判定（无滚动活动保留 pre-paint 写）。自测 typecheck / test(214) / build 全绿，动态检查（滚动活动期间 microtask 不写 + 静止后 debounce 补写回底）通过 → done
- 2026-09-01 主线合入测试通过（merge `53d93b8`），人工验收通过 → closed
- **真凶定位过程**：初始判断「写 scrollTop 打断弹性动画」方向正确，但「何时该写」错了两次——迭代 1 靠「下次 render 补回底」①撞上输出恰在动量末尾停止的恢复空洞；迭代 2 靠「意图过期就写」②在弹性回归动画中途写（回归阶段通常比最后一个 wheel 事件晚 200ms+，意图已过期），打断动画→再弹→再打断→连续碰撞，且迭代 2 的 scroll 监听同步 settle-restore 是碰撞主犯。迭代 3 才收敛到「**碰撞不在意图过期，而在写的时候滚动还在动**」——由用户实测现象（密集输出「底部拉住 + 惯性反弹同时作用」、稀疏输出「连续碰撞」）反推确认。
- **用户判断是定盘星**：headless 无法复现惯性/弹性（合成 wheel 不触发原生弹性），三轮人工验收 + 用户两次现象描述是唯一可靠信号；第 2 轮「回弹停在不触底就不动了」直接指出了恢复空洞，第 3 轮的形态描述直接给出碰撞条件。
- **测试伪影两例**：浏览器缓存旧 dist bundle（需 cache-bust + 干净 server）、后台 tab `setTimeout` 被节流到 ~1s（定时器类验证需加长等待）。
- **机制佐证**：WebKit bug 255193（设 scrollTop 停止 scroll inertia）、hermes-webui PR #5685（瞬态 scrollHeight 单帧抖动 + microtask 修法）、Chrome 官方「掌控滚动操作」（overscroll-behavior none = 断链 + 禁自身回弹）、StayDown/TheLounge（lock/release 意图模型）。
- 贴底 + 惯性下滑在极端时序下仍可能有一点点轻微残留（用户反馈「还有一点小问题，可以接受」），具体形态未再展开；机制上最可能的剩余窗口是「动量恰好在内容短时离底时结束」的极窄竞态（intent 过期与 settle 定时器之间的时序缝隙），是否完全消除依赖真实触控板长期使用观察。
- 副作用：`overscroll-behavior-y: none` 关闭了 macOS 原生回弹手感（本 bug 的取舍，用户接受）；如后续想保留手感，可改为「只在滚动活动期间不写」的纯行为层方案（弃 CSS 防线），或对照 dsh web 官方行为再定。

## 发送消息后自动滚动到最新

slug: scroll-to-bottom-on-send

- 2026-08-31 认领（worktree: agent/scroll-to-bottom-on-send）→ doing
- 2026-08-31 开发完成，自测通过 → done
- 2026-08-31 主线合入测试通过，人工确认 → closed

## 批量归档 session（未分组走统一多选，不特殊处理）

slug: session-batch-archive

- 2026-09-02 提出需求 → open
- 2026-09-02 与用户确认交互方案（多选模式、三态复选框、确认框形态、取消按钮=退出模式）
- 2026-09-02 确认未分组不特殊处理：组头复选框 + 顶部归档按钮即覆盖，去掉未分组右键专属入口
- 2026-09-02 认领 → doing（worktree: agent/session-batch-archive）
- 2026-09-02 开发完成，自测通过（typecheck/test/build + 视觉场景截图核对）→ done
- 2026-09-02 补充：组头全选语义收紧（有置灰项只能半选）+ 点组头不可全选时飘提示
- 2026-09-02 主线合入（90e5ff9）+ 人工 dev-ui-test 验收通过 → closed

## 会话引用 chip 与同行文字基线不齐

slug: session-mention-baseline-offset

- （无变更记录）

## 会话菜单右键错位：列表重建/重排与用户瞄准时机不一致（命令对象错位）

slug: session-menu-reorder-freeze

- 2026-09-02 记录问题，核实 webview 侧两处锚断链路径与快照触发链；用户方案（菜单期间冻结重排）记为推荐方向 → open
- 2026-09-02 用户补充：默认排序（updatedDesc）+「鼠标悬浮、右键之前排序变了」场景——核实 W1 机理（同步重建、命中行=重排后行、瞄准时机错位），冻结窗口改为 pointerdown 起（覆盖 W2/W3），补 W1 防御（菜单标题显式化 + 重排可感知提示）
- 2026-09-02 用户给出真实复现案例（A send 后变最新跳前 → 右键"B 的位置"命中 A 误归档）并提案「每次发送就刷新」：核实 send 分支无 refresh、A 跳前面的现状路径为标题变化触发的 refresh；方案定为①send 时 refresh（用户提案）+②pointerdown 起冻结+③菜单首行显示会话名，附加待确认真机基准行为
- 2026-09-02 调研 refresh 触发点全集：无轮询（无 2min 定时刷新）；近似机制 60s 本地 tick 仅刷相对时间文案（不发 RPC）；确认方案①为新增显式触发点（send 后追平 updatedAt），非替代轮询
- 2026-09-02 用户定案刷新触发点：send 后 + VS Code 窗口聚焦时（onDidChangeWindowState focused=true）；可选扩展（打开/附着会话、turn 结束）列为待定；待确认焦点粒度（窗口级 vs 面板级）
- 2026-09-02 用户扩展触发语义：一切让 dsh-one 侧栏从不可见（焦点丢失、被文件管理器等覆盖）到可见的事件都刷新——补 onDidChangeVisibility（view.visible）+ resolveWebviewView（webview 重建）两个事件源，editor 面板 onDidChangeViewState 列为顺带候选；建议统一入口加 500ms 级去抖
- 2026-09-02 用户补充状态变化触发：待交互（approval/question 请求/解决）与完成（running 翻转）时刻也刷新——状态标记走增量帧即时显示（无需刷），但排序键 updatedAt 增量帧不更新（服务端同一时刻更新了）；挂点：applyFrame 的 session-status 实际翻转处 + onMuxFrame 的 track/resolvePending changed=true 处；固化循环规避要点（仅增量路径触发，refresh 内重放不递归）
- 2026-09-02 用户提问与置顶冲突：核实无数据冲突（pinned 为本地持久化状态，refresh 不碰；置顶恒在非置顶前），置顶组内仍按最新优先（既有语义+官方同款，非 refresh 引入）；产品语义待确认（组内最新优先 vs 绝对固定——后者为新需求，可单独立项）
- 2026-09-02 用户定案置顶语义：绝对优先（组内固定，新置顶放最前）——详见独立条目 session-pin-absolute-order；本条目置顶组内的错位关注随之消解
- 2026-09-02 review 修正：①W1 示例方向反了（应为"瞄 B 的位置命中 A"）并改述机理——错位来自"记忆锚定"（屏幕显示新顺序、用户看得见但没感知），非视觉-逻辑错位帧；②"基本必然"改"很可能"（pending 时刻服务端 updatedAt 更新属推测）；③统一去抖从"建议"升为"必须有"（send + running flip 等连发，无去抖一回合多组全量 RPC）；④补③的强度诚实评估（归档已有 modal 确认仍被跳过——③同强度为弱防线，主防线是①）
- 2026-09-02 认领（worktree: agent/session-menu-reorder-freeze）→ doing
- 2026-09-02 开发完成（分支自测通过 + done 标记），主线合入（merge ok）测试通过，用户人工验收通过 → closed

## 会话打不开时界面无提示：点击无反馈 / 仅「本轮运行失败」气泡

slug: session-open-failure-no-hint

- 2026-09-05 session-open-failure-hint 认领（open → doing）。
- 2026-09-05 session-open-failure-hint 开发完成（doing → done，附实现/自测/报告结论）：
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（4d28d22），报告 12 项全过、人工审查通过（F-01 截图重拍后核对）。

## 点击其他 session 时保护有未发送内容的 tab（dirty tab 不覆盖，改开新 tab）

slug: session-open-protect-dirty-tab

- 2026-09-XX 需求确认 → open
- 2026-09-XX 认领 → doing
- 2026-09-02 开发完成（worktree agent/session-open-protect-dirty-tab，commit 795a64d/af678a5）：webview 上报 composer 脏位（文本/附件，切换帧强制重报），host openSession 目标 tab 脏位为 true 时改走新 tab；顺带修空态草稿切走不存档。自测 typecheck + 330 tests + build 全绿。→ done
- 2026-09-02 人工 dev-ui-test 验收通过（用户）；主线合入（merge $(git log --format=%h -1 --grep="merge(agent)")），复测 typecheck/330 tests/build 全绿 → closed

## 置顶 = 绝对优先：置顶组内按置顶顺序固定（不随 updatedAt 变动）

slug: session-pin-absolute-order

- 2026-09-02 用户确认置顶语义（绝对优先）+ 选定规则（新置顶放最前）→ open
- 2026-09-02 认领（worktree: agent/session-pin-absolute-order）→ doing
- 2026-09-02 实现完成：置顶组内按置顶数组顺序固定（绝对优先），setPinned 改 unshift/splice；typecheck/test/build 全绿（test 320 通过），dev-finish 打 done 标记 → done
- 2026-09-02 主线合入测试通过（merge 52fd860），用户人工验收通过 → closed

## 会话行补「已完成」绿点

slug: session-row-completed-dot

- 2026-08-31 认领（worktree: agent/session-row-completed-dot）→ doing
- 2026-08-31 开发完成，自测通过 → done
- 2026-08-31 主线合入测试通过，人工确认 → closed

## 会话行状态标记移到行尾时间位（与时间互斥）

slug: session-row-status-to-time-slot

- 2026-09-06 用户提出（先讨论时间语义：显示的是「上次输入时间」而非最后活动时间，运行中会话显示旧时间造成困惑）；讨论后改为布局方案：状态标记与时间互斥、集中在行尾。原型两轮调优（垂直居中 → 标记中心共线）后用户确认 → 建条目（open/）
- 2026-09-06 认领（doing）：用户确认「记录 backlog 并认领开工」，开 worktree 开发
- 2026-09-06 开发完成，自测通过 → done（592 项单测全过、typecheck/build 通过；ai-visual-validation 新场景 sessions-status-rear-slot + 9 个侧栏基线场景逐项核对通过；沙盒真环境回归 4 项全 pass——含「慢命令」24s 流式期间侧栏运行中像素环、完成后恢复时间；验收报告 test/sandbox/verify.session-row-status-to-time-slot.report.html）
- 2026-09-06 用户微调：行首槽只剩置顶图钉导致标题缩进过大(38px) → 移除行首状态槽、图钉移标题前，标题缩进回到 16px；重跑 dev-finish → done（a42e640）
- 2026-09-06 主线合入 session-tag-groups（大更新），rebase + 适配 → done：排序层级合并为 置顶 > 组块序 > 活跃层 > sort 键（组件内生效）；渲染层自动合并后复验组块/行尾互斥/图钉标题前组合布局；用户确认组块下「行首空槽（红框）」已随布局移除。（最终标记 cb61041）
- 2026-09-06 用户微调：无 pin/无分组的普通行标题太贴左 → 左缩进 12→20px（与组块行 24px 差 4px），置顶行/组块行不动 → done（e5ca5bc）
- 2026-09-06 主线合入测试通过（dev-merge 83df431，612 项回归全过），用户确认 → closed

## 会话级统计行：输入框下方对齐官方（轮数/步数/时长/缓存）

slug: session-stats-row

- 2026-09-05 差异对账发现（官方输入框下方统计行）→ 建条目（open/）
- 2026-09-05 认领（open → doing，worktree: agent/session-stats-row）。
- 2026-09-05 开发完成（worktree: agent/session-stats-row，commits 6d982ce+ef58b96+42bc341+7f32cd9+c4dda68，done 标记 c4dda68）。落地：formatStatsLine 增 tokenUsage 参数补「缓存命中 X% · 输入/输出 tok」组（官方 StatsLine 同构）；时长格式化本地化（zh 2分42秒/45.2秒，原硬编码英文单位）；组间分隔符改 ASCII「 | 」；文案键对齐官方（TTFT avg/Tool call/Cache hit/Input…Output）；缓存命中与紧凑 token 助手从 webview 上移 pure 合并一份；chatSession 折叠 tokenUsage 投影（基线+live 任一落地即重算统计行），0.1.1 无 tokenUsage 时行照常显示 sessionStats 可得字段。自测：typecheck/523 tests/build + check-i18n 全绿。报告 test/sandbox/verify.session-stats-row.report.html：F-01 harness 官方全字段行+context 环 pass、F-02 沙盒真 dsh 0.1.2-rc.1（容器内升级）统计行折叠 pass、F-03 本机 0.1.2-rc.1 真实投影字段覆盖（sessionStats 8 字段+tokenUsage 4 桶，真实值出 EN/ZH 全行含缓存命中 99%）pass、F-04 无投影整行隐藏 pass、R-01 0.1.1-rc.2 沙盒回归 pass（实测 0.1.1 也有 sessionStats——条目原「无投影不显示」假设不成立，实际降级=显示可得字段）、R-02/R-03 conversation/turn-usage-detail webview 回归 pass。→ done
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed

## 换会话时滚动位置不恢复（自渲染聊天面板缺 per-session 滚动记忆）

slug: session-switch-scroll-restore

- 2026-09-01 核实并定位根因（源码核对 dsh-one webview.ts 与官方 dsh-client-ui-conversation/lib/client.js），写入 open→open
- 2026-09-01 认领（worktree: agent/session-switch-scroll-restore）→ doing
- 2026-09-01 开发完成，自测通过（typecheck + 184 tests + build）→ done
- 2026-09-01 主线合入测试通过（200 tests + build），人工 dev-ui-test 窗口验收通过 → closed

## 会话标签分组（Chrome 垂直标签式）

slug: session-tag-groups

- 2026-09-05 用户提出（侧栏 session 分组，Chrome 垂直标签式，先出原型确认）；补充：预设 todo/doing/done 组 + 自定义组、拖拽入组、拖组排序、整组批量归档/移入回收站、预设组名走 l10n → 建条目（open/）
- 2026-09-06 认领（doing）：用户确认方案，开 worktree 开发
- 2026-09-06 开发完成（done）：单测 602 项全过，ai-visual-validation 场景核对通过，沙盒回归通过，dev-finish 打标 done/session-tag-groups → 47010c3，验收报告 test/sandbox/verify.session-tag-groups.report.html
- 2026-09-06 开发中补充（折叠/展开）：组头 pill 后加小三角，组块可折叠（workspaceState 持久化），搜索态强制展开、拖入折叠块自动展开；修复「右键选组不立即刷新」（setSessionTag 等未 rebuildModel，快照仍是旧模型）；单测 602 全过，折叠场景 session-tags-collapse 进入基线，报告更新为 8 项全 pass（dev-finish 打标 ede0d33）
- 2026-09-06 开发中补充（重命名/改色/新建选色）：所有组（含预设）可右键重命名（预设改名后覆盖 l10n 默认名）与改色（Color… 6 色子菜单）；「New group…」弹层带名字输入 + 6 色色板（默认轮换色）；预设组保持不可删除。单测 602 全过，报告 9 项全 pass（dev-finish 打标 2ab2391）
- 2026-09-06 开发中补充（折叠组头计数）：折叠的标签组块在 pill 行右端显示组内待处理计数（待交互/运行中/未读，与 workspace 组头同规则），展开态不显示。单测 602 全过，报告 10 项全 pass（dev-finish 打标 970f95c）
- 2026-09-06 开发中调整（移到分组改二级菜单）：行菜单不再平铺组列表，改为「Move to group… ›」单项 + 二级菜单（各组/No group/New group…），与工作区「分组…」同款交互；新增基线场景 session-tags-row-menu-groups；单测 602 全过，报告 10 项全 pass（dev-finish 打标 e17f33c）
- 2026-09-06 开发中调整（二级菜单改上下 accordion）：侧栏窄放不下横排二级，改为菜单内上下展开/收起（Move to group… ▸/▾ 指示，组列表内嵌缩进一级），单弹层无叠加；单测 602 全过，报告 10 项全 pass（dev-finish 打标 6b1b435）
- 2026-09-06 主线合入并回归通过，人工确认 → closed（merge a8c9100；主线回归 typecheck + 608 项单测全过，侧栏组块冒烟渲染 4/4/4 正常）

## 活跃会话留在标签组块内（组块是容器），只有未分组活跃会话平铺最外

slug: session-tags-active-inside-group

- 2026-09-06 主线排查「标签页分组不能用了」：核实现象（组内全活跃 → 组块整体消失）与根因（排序/渲染的 active-脱离-组块语义）；用户拍板新语义（组块是容器，组内活跃排组内最上，未分组活跃才平铺最外）；随后拍板折叠细节（折叠就全藏，含活跃；计数计入组内全部会话）→ 建条目（open/）
- 2026-09-06 开发完成（doing → done）：主线语义核定后开 worktree（agent/session-tags-active-inside-group）。改纯层排序（三层：置顶 → 未分组活跃 → 组块-组内活跃前置 → 无组空闲，tagIdOf 统一降级）+ 渲染聚合（tagBlockItems 去掉 s.active 平铺条件，有组即聚块；折叠全藏含活跃；计数计入组内全部会话）。单测 614 全过（sessionTree 56 项，含新层级断言），ai-visual-validation 场景核对通过（F-01..F-04），基线 62 场景回归通过（R-01..R-03），dev-finish 打标 done/session-tags-active-inside-group，验收报告 test/sandbox/verify.session-tags-active-inside-group.report.html
- 2026-09-06 主线合入并回归通过，人工确认 → closed（merge 后 typecheck 0 错误 + 614 项单测全过 + 主线 dist 抽查：组块是容器语义渲染正确；原 open 条目已含完整背景与拍板记录）

## 侧栏会话排序层级调整：活跃会话 > 标签组 > 时间序

slug: sessions-active-over-tags

- （无变更记录）

## 侧栏会话列表滚动位置随快照丢失（折叠工作区跳顶等）

slug: sessions-list-scroll-position-lost

- （无变更记录）

## 侧栏 sessions 树 + chat 移进编辑器（懒打开）

slug: sidebar-sessions-tree-editor-chat

- （无变更记录）

## `/goal` 命令不被识别（官方 0.1.2 有 dsh-command-goal）

slug: slash-goal-command

- 2026-09-05 用户截图反馈 + 官方依赖核实（dsh-command-goal 存在）→ 建条目（open/）
- 2026-09-05 开发 session 认领（open → doing）：实测 0.1.2-rc.1 确认面板侧 goal 补全/透传均已存在且 wire 正确；根因=用户默认 preset（kimi，旧版 standard 拷贝）未装载 command-goal，待 worktree 开发 + 报告。
- 根因：用户默认 preset「kimi」（~/.dsh/.agent-presets/kimi，0.1.1 时代 standard 拷贝）在 0.1.2 架构下缺 command-goal——0.1.2 把 command-goal 从宿主平面移进 preset 组合（standard/ptc/cordis 自带），kimi 只挂 tool-goal；其默认会话 commands/list 无 goal、/goal 返回未匹配 → 面板提示「未知或格式错误的命令」。临时 home 真 0.1.2-rc.1 复现（标准 preset 可、kimi 不可）。
- 面板侧（补全表 goal 项 + commands/execute 透传，wire=args{agentId,line,images}）核实已存在且正确；官方 0.1.2 /goal 七种输入语义逐条实测（show/create/edit/pause/resume/clear/edit-bare 报错/未知词=create）。
- 代码改动（branch agent/slash-goal-command，852e304）：未匹配时区分「面板广告的宿主内建命令」（定向提示：宿主未提供，检查 preset/dsh 版本）与拼写错（官方同款文案）；pure/slashCommand 加 slashCommandName + HOST_SLASH_COMMAND_NAMES + isHostSlashCommand，l10n 中英一条，单测 2 个，519 全绿。
- 沙盒报告：test/sandbox/verify.slash-goal-command.report.html（5 项全过，mock-llm + 真 dsh 0.1.1-rc.2；0.1.2 语义/根因在真 0.1.2 环境实测，见本条目与 ledger coverageNote）。
- 遗留：用户 kimi preset 需补 command-goal 行（`- id: command-goal/name: '@deepseek-ai/dsh-command-goal'`）才能真正用上 /goal；新增同类命令（如未来官方新命令）面板静态表同样滞后——同机制已能给定向提示，未扩展。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed

## spawnDsh Windows 输出管道 bug（detached+shell 的输出不落盘）

slug: spawn-dsh-windows-output-pipe

- 2026-09-01 记录 → open
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，CI 实测验证通过 → done
- 2026-09-01 主线合入测试通过 → closed（merge commit 8e03ccd）

## skill / cordis 专用工具卡缺失（渲染成通用工具行）

slug: specialized-tool-cards

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成 → done（worktree: agent/specialized-tool-cards）
- 2026-09-01 修复：流式输出时展开区内部滚动位置保持（14a0ca6）
- 2026-09-02 主线合入测试通过，人工验收通过 → closed（merge 1a94189）
- `src/pure/chatContract.ts`：`ChatToolBlock` 加 `meta?`（tool/result 原样透传）。
- `src/pure/conversation.ts`：`applyToolResult` 透传 `data.meta`。
- `src/pure/toolCards.ts`（新）：skill/cordis 四类卡的派生模型（对齐 web
- `src/ui/chat/webview.ts`：`renderTool` 按 `block.name` 分流 `skill` /
- `src/ui/chat/icons.ts`：新增 SKILL_ICON / CODE_ICON / STOP_ICON / TRASH_ICON
- `src/ui/chatView.ts`：专用卡样式（行首图标位、分隔点、错误红字、用途灰字、
- `test/toolCards.test.ts`（新）：13 例；`test/ui/scenarios.js`：6 个专用卡场景

## 开启未分组对话

slug: start-ungrouped-conversation

- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 tests + build）→ done
- 2026-09-01 主线合入（dev-merge 复测通过），人工 dev-ui-test 验收通过 → closed

## 启动期未分组组先于工作区显示

slug: startup-ungrouped-flash

- 2026-09-02 问题核实、定位根因，记入 open/（未开始修改）。
- 2026-09-02 认领（open → doing），开始 worktree 开发修复。
- 2026-09-02 开发完成（doing → done）：store 加 baselineReady 标志（refresh 成功置 true、代际切换重置 false），快照带出；webview 在 serverState=running 且基线未就绪时显示 Loading，不渲染未分组组头/添加引导。typecheck + 337 单测 + build 通过；新增 sessions-baseline-loading（未就绪 → Loading）与 sessions-no-workspaces（基线就绪但无 workspace → 引导 + 未分组组头，对照）两个视觉场景，已截图核对。
- 2026-09-02 主线合入（done → closed）：merge commit ece02b7，人工隔离 VSCode 窗口验收通过（用户确认）。

## 状态栏 tooltip：adopted / external 实例也显示 dsh 版本

slug: statusbar-adopted-version

- 2026-09-05 用户反馈（截图：外部启动实例 tooltip 无版本行）+ 讨论拍板「从实例命令行解析真实入口执行 --version 查询」→ 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree statusbar-adopted-version）；实现如上；新增单测 13 项（parse 形态 9 + probe 执行 1 + tooltip 3），全量 567 通过
- 2026-09-05 开发完成（doing -> done）：分支 agent/statusbar-adopted-version；实现 = 记录优先 + 命令行解析真实入口执行 --version（探询 fail 缺省不显示）；自测 typecheck/567 单测/build 全绿；ledger test/sandbox/verify.statusbar-adopted-version.ledger.json（7 项全过，覆盖说明：宿主 tooltip 不随沙盒渲染，单测 + 人工开窗）。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（2c7415d）；ledger 7 项全过、审查通过；宿主 tooltip 项留待本机 reload 后人工开窗复核（与 statusbar-dsh-version-tooltip 同口径）。

## 状态栏「未安装 dsh」提示温和化

slug: statusbar-dsh-not-found-friendly

- 2026-09-03 用户提出：未安装 dsh 时状态栏红色 Error 碍眼，此为正常预期状态。核实 manager 已有 reason 字段、statusbar 未消费，方案如上，进 open/。
- 2026-09-03 认领，进入开发（worktree agent/statusbar-dsh-not-found-friendly）。
- 2026-09-03 开发完成（typecheck + 337 测试 + build 全过，done 标记 7ce7cf2）：statusbar 识别 dshNotFound 显示黄色「未安装」+ tooltip 安装链接 + 点击跳安装页，真实错误保持红色 Error。待主线合入与人工验收。
- 2026-09-03 主线合入（merge commit 见 dev-merge，rebase 后复测 337 测试全过 + dist 重建；用户已看视觉报告确认效果，未跑 dev-ui-test 窗口）。

## 状态栏 tooltip 显示 dsh 版本

slug: statusbar-dsh-version-tooltip

- 2026-09-05 用户反馈（升级 0.1.2 后想随时确认版本）→ 核实现状 → 建条目（open/）
- 2026-09-05 认领（open → doing）：按条目方案开发；版本取 locateDsh 已执行的 `dsh --version`（spawnSync），经 pidfile 持久化供 re-own；adopted 不显示版本（外部实例，避免误导）。
- 2026-09-05 开发完成（doing → done）：版本取 locateDsh 已执行的 `dsh --version`，经 ServerStatus.version + pidfile 持久化；running 态 tooltip 标题下加 `dsh v{version}`（adopted 外部实例不显示，保留原 external 说明）。自测 typecheck/test(509)/build 全绿，单测 mock ServerStatus 逐态 9 项；报告 test/sandbox/verify.statusbar-dsh-version-tooltip.report.html（覆盖方式：宿主 tooltip 不随沙盒渲染 → 单测 + 本机人工开窗，验收命令已交付用户）。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed

## statusbar「Retry Starting / Start Service」绑定 dshOne.openExternal——label 与行为不符

slug: statusbar-retry-start-open-browser

- 2026-09-03 Remote-SSH 调研时发现（statusbar.ts:77,83 与 extension.ts:120-123 核实）→ 记入 open/（未开始修改，定级待确认）。
- 2026-09-04 方案讨论拍板：走方案 A（新增 `dshOne.start` 只启动不开浏览器，Retry/Start 改绑），方案 B 否决；补充 package.json 命令注册与 remote-ssh-support 条目分工 → 条目更新（仍 open/，未开始开发）。
- 2026-09-04 认领：worktree slug `statusbar-start-command`，按方案 A 实施（新增 `dshOne.start` 只启动/重试不开浏览器，Retry Starting / Start Service 改绑；开发结果见条目完成时追加）。
- 2026-09-04 开发完成（doing → done）：方案 A 落地——新增 `dshOne.start` 命令（`src/extension.ts` 注册，只 `ensureStarted()` 不开浏览器），`src/ui/statusbar.ts:77,83` 的「Retry Starting / Start Service」改绑它；「Open in Browser」与整块点击保留 `dshOne.openExternal`，运行中态「Restart Service」仍走 `dshOne.restart` 不变；`package.json` contributes.commands 新增 `dshOne.start` 条目，`package.nls.json`/`package.nls.zh-cn.json` 补标题（Start Service / 启动服务）。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed

## 插话快捷键占位符按平台区分文案（macOS ⌘Enter vs Win/Linux Ctrl+Enter）

slug: steer-shortcut-copy-per-platform

- 2026-09-08 用户要求排查平台差异化文案后记录：建条目（open/）
- 2026-09-08 认领（worktree: agent/steer-shortcut-copy-per-platform）→ doing
- 2026-09-08 开发完成，自测通过（typecheck + 568 单测 + build + check-i18n + 沙盒报告 4 项全 pass：F-01 运行中占位符 Linux 容器真实命中 Ctrl+Enter 分支，报告 test/sandbox/verify.steer-shortcut-copy-per-platform.report.html）→ done
- 2026-09-08 主线合入测试通过（dev-merge 复测 + dist 重建），用户直接确认合入 → closed

## 等待插话（steering）气泡：附件与引用要像正式用户消息一样渲染

slug: steering-bubble-rich-render

- 2026-09-03 记录 → open（用户口头需求）
- 2026-09-03 认领（worktree: agent/steering-bubble-rich-render）→ doing
- 2026-09-03 开发完成（worktree 自测：typecheck/334 单测/构建通过；视觉场景 steering-pending 截图对照：附件缩略图+文件 chip+会话 chip+引用摘要行均与正式用户消息一致，mention-chips/attachment-uniform 无回归；done 标记待打）→ done
- 2026-09-03 人工窗口验收通过（用户确认合入）；主线 dev-merge.sh 合入（--no-ff，merge 90a930d，336 测试通过，dist 重建）；主线 baseline 冒烟 31 场景截图正常（steering-pending/attachment-uniform/mention-chips 无回归）→ closed

## 等待插话气泡：与落地后消息渲染不一致，多行时 spinner 远离气泡

slug: steering-pending-bubble-layout-inconsistent

- 2026-09-03 用户反馈「插话中 UI 与插话完成后的气泡渲染不一致，多行时转圈 UI 容易离气泡较远」→ 探针复现（676px 列宽：待落地 206px/2 行 vs 落地 217px/1 行）→ 核实根因（气泡 max-width:85% 按 shrink-to-fit 的 body 宽度解析；spinner 对整列 body 居中）→ 静态探针验证修复方案（`.steering-line` 撑满行宽后两态一致、spinner 距气泡 6px 居中）→ 记入 open/（未开始修改）。
- 2026-09-04 认领（open → doing），按条目方案在 worktree `steering-pending-bubble` 开发。
- 2026-09-04 开发完成（doing → done）在 worktree `steering-pending-bubble`：按方案重构 `renderSteeringItem`（spinner+bubble 包进 `.steering-line`）+ CSS 换 `.msg.user .steering-line` 规则 + scenarios 新增 `steering-pending-narrow`；自测全绿（typecheck / 386 项 test / build）；测试报告 `test/sandbox/verify.steering-pending-bubble.report.html`（F-01 布局 / F-02 676px 单行 pass；R-01 conversation、R-02 真 dsh+mock-llm 回显 pass）。
- 2026-09-04 主线合入（merge 后人工确认，用户审报告通过）→ closed

## 头部「N 个子代理」chip 改树形缩进列表（支持子代理再开子代理）

slug: subagent-header-tree

- （无变更记录）

## dsh-one 子代理菜单显示临时名字（dsh web 显示任务描述）

slug: subagent-temp-name

- （无变更记录）

## 窗口 reload 后不恢复已打开的 tab（会话 chat tab 与 dsh web tab）

slug: tab-restore-on-window-reload

- 2026-09-0X 用户反馈并确认「直接做」→ 认领（worktree: agent/tab-restore-on-window-reload）→ doing
- 2026-09-0X 开发完成（worktree agent/tab-restore-on-window-reload，rebase 到含 session-open-protect-dirty-tab 的最新 main）：注册 WebviewPanelSerializer（chatPanel 按 tabId 映射重建、dshOne.tab 重新 bind）；workspaceState 增量维护 tabId → sessionId 映射（整表重建会覆盖未恢复面板）；webview 内容经 acquireVsCodeApi().setState 提供恢复凭据；服务未 running 时走现有 lastActive/pendingRestore 链补附着。自测 typecheck + 330 tests + build 全绿。→ done
- 人工 dev-ui-test 验收通过（用户，隔离 VSCode 窗口：两 chat tab + dsh web tab reload 后全部原位恢复；全关后 reload 不恢复）
- 人工 dev-ui-test 验收通过（用户）→ 主线合入（merge 9e1074c），复测 typecheck/334 tests/build 全绿 → closed

## 任务清单「进行中」运行符号在消息流输出时疯狂刷新

slug: todo-in-progress-spinner-flicker

- （无变更记录）

## 任务清单卡（输入框上方，todos 投影）

slug: todo-panel-card

- 2026-09-01 认领（worktree: agent/todo-cards）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed

## 消息内 todo_write 任务卡

slug: todo-write-call-card

- 2026-09-01 认领（worktree: agent/todo-cards）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed

## tool call 卡可展开（IN/OUT）

slug: tool-call-expandable

- （无变更记录）

## 工具输出里的本地路径图片不显示（read_image 等）

slug: tool-output-path-image-not-rendered

- 2026-09-05 用户界面检查（Read read_image 后图片缺失）→ 视觉验证（harness 场景 data-URI vs 路径对照）→ 确认：路径图片不显示、data-URI 正常 → 建条目（open/）
- 2026-09-06 认领（worktree: agent/tool-output-image-render）→ doing
- 2026-09-06 开发完成（doing → done，worktree tool-output-image-render，branch agent/tool-output-image-render）：方案 1（host 图片通道，扩展名/10MB 双闸，全路径形状，不覆盖 WS/远端——扩展只连本机 127.0.0.1 dsh，无远端路径场景）。实现：pure/inlineImage.ts 策略层；chatContract 新增 requestInlineImage；chatMessages 宿主处理（resolveLinkPath 归一 + 双闸 + 复用 fileFetchQueue/runAttempts，回执复用 fileThumb/fileThumbFailed）；webview DOMPurify 钩子放行 img src 路径形状 + decorateMarkdownImages（占位/真图/失败 chip，回执后就地替换——增量对账下未变行不重建）；mock-llm 新增 4 条内嵌图片规则 + /tmp/mdimg-* fixture 预置。自测全绿（typecheck/test 620/build）；沙盒报告 6 项全 pass（verify.tool-output-image-render.report.html：F-01 绝对路径+data: 同帧对照、F-02 file: URI、F-03 缺失、F-04 超限、R-01 既有 markdown、R-02 兜底回显）。
- 2026-09-06 主线合入测试通过，人工确认（merge commit 5f9fa3f）→ closed

## 回合轨道栏在 480~748px 窗口宽度下压文字

slug: turn-rail-narrow-overlap

- （无变更记录）

## 流内状态提示行缺失：compaction 卡 / 重试倒计时 / 超 token 提示

slug: turn-status-notice-rows

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成：typecheck + 268 测试 + build 全绿；视觉场景 DOM 断言通过 → done（worktree: agent/turn-status-notice-rows）
- 2026-09-01 主线合入（a66cb75，rebase 解决与 deliverables-produced-files 的冲突后复测 298 测试全绿）；人工 dev-ui-test 窗口验收通过（超 token 提示 / 重试行倒计时 / compaction 卡三项均确认）→ closed

## AI 视觉验证（chat webview 独立渲染 + mock 后台 + 期望描述核对）

slug: ui-visual-validation

- 2026-09-01 认领（worktree: agent/webview-render-test）→ doing
- 2026-09-01 开发完成（自测通过：typecheck/test/build 全绿）→ done
- 2026-09-01 合入 main（89fc712）+ 主线基线冒烟通过（11 场景出图，抽查 conversation/sessions 渲染正确）+ 人工确认 → closed

## 未安装 dsh 界面的非官方一键安装脚本

slug: unofficial-install-script-ui

- 2026-09-03 用户直接提出需求；主线 stash 后转入 worktree 开发（slug: unofficial-install-script-ui）。
- 2026-09-03 开发完成：自测通过（typecheck/build/test 337 通过），已打 done/unofficial-install-script-ui 标记，待主线合入前人工 dev-ui-test 验收。
- 2026-09-04 主线合入（5da2e6e）并人工确认 → closed

## verify-driver 反复挂死（进程存活、无输出、永不返回）

slug: verify-driver-hang-investigation

- 2026-09-06 用户反馈「反复出现的问题都是咋回事（挂死）」→ 汇总 slash-goal/commit-card 两实例 + 会话层 delta 0 → 建条目（open/，调研任务）
- 2026-09-05 调研 session 完成：读码盘点等待点 → 最小实验复现挂死机制（Playwright 已知缺陷：挂起导航 iframe 上 evaluate/count 永不返回）→ 沙盒实例 hang-inv 复跑 10 轮未撞窗口（标注推断）→ 根因/修复/防复发写入本条目；未改代码，建议开发 session 认领修复（涉及 verify-driver.mjs 帧过滤 + 竞速看门狗 + 全局兜底，非一行修）。
- 2026-09-06 开发 session 认领修复（doing）：按「修复方案」1-4 仅改 test/sandbox/verify-driver.mjs（帧过滤 + 竞速看门狗 bounded + 每项 5min 全局兜底 + 冒烟预热/单轮重试），worktree = verify-driver-hang-fix
- 2026-09-06 开发完成（doing -> done，worktree verify-driver-hang-fix，done 标记 f1cb2a5）：仅改 test/sandbox/verify-driver.mjs——全部帧扫描循环跳过空 URL 帧；bounded() Promise.race 竞速看门狗（默认 10s，WatchdogError 带 label）接入 findFrame predicate / waitForText count / approvePending count+isVisible / waitForDraft evaluate / fillAndClickClear evaluate / popoverCommitCardVisible count / newChat 头部按钮 count，watchdog 超时由条目级 catch 转 fail + notes 帧快照诊断（不裸 throw 出扫描循环）；每项 5min 硬上限兜底；首项前冒烟预热 + fail 项整轮自动重试一次。验证：复现侧——假 workbench 确定性复现台上原版 3/3 挂死（>60s 无输出、unsettled TLA 停在 L320）、修后版 9.7s 完成；聊天帧挂起场景 fail-fast + 帧快照 + 自动重试后进程自行退出；bounded() 微测试 3/3；min-repro2 机制复确认吻合。正常路径——真实沙盒（独立实例 8095）跑 CI 基线 F-01/F-02/F-05 场景全 pass，截图语义核对通过。报告 test/sandbox/verify.verify-driver-hang-fix.report.html（7 项全 pass），npm test 554/554 无回归。待主线合入。
- 2026-09-05 合入（done -> closed）：修复 dev-merge 合入 main（verify-driver.mjs，帧过滤+竞速看门狗+5min 兜底+冒烟/重试），报告 7 项全过、人工审查通过；根因与修复方案见本条目正文，复现台 /tmp/verify-driver-fake/。

## 视觉交互场景支持分步截图（interact 阶段化）

slug: visual-interaction-step-shots

- 2026-09-05 记录（open）：workspace-groups-submenu-hover 复盘提出的缺口之一，本次仅记录不开发。
- 认领（open → doing）：方案确认开工——`interactSteps: [{name, script, settle?}]`，harness 每步执行后置 `window.__interactStepDone = name`，ui-visual.sh 轮询到信号后截 `<scenario>-<step>.png` 并调 `window.__interactStepAdvance()` 放行下一步；兼容：无 interactSteps 场景行为不变。演示场景：`sessions-workspace-menu-groups` 拆成「右键开主菜单 → hover 分组…展开二级」两步。worktree：agent/visual-step-shots。
- 开发完成（doing → done，worktree agent/visual-step-shots HEAD a0af296）：① scenarios.js 支持 `interactSteps: [{name, script, settle?}]`（与 interact 二选一，同时存在时 interactSteps 优先），`sessions-workspace-menu-groups` 拆两步，expect 按每张截图一个子状态重写；② harness.html 步进执行器：每步脚本 + settle（默认 500ms）后置 `window.__interactStepDone = name`，`window.__interactStepAdvance()` 放行下一步；③ ui-visual.sh 对含 interactSteps 的场景逐步：轮询完成信号到位 → 截 `<scenario>-<step>.png` → advance（bash 3.2 兼容：无关联数组；daemon 响应取 `data.value`）；无 interactSteps 场景行为不变（单张）。④ 文档：ai-visual-validation skill 补 interactSteps 用法，scenarios.js/harness.html 头注释同步。自测 typecheck + 537 tests + build 全绿；ui-visual 全量 135 场景回归 + 基线 34 场景（分步场景两张对照图确认：menu 帧仅顶层菜单 6 项、groups 帧二级菜单 + 顶层并存）；报告 test/sandbox/verify.visual-interaction-step-shots.report.html（F-01 分步对照 + R-01 单张兼容 + R-02 全量回归 + R-03 typecheck/test/build，全 pass）。webview 产品代码无改动，沙盒 E2E 不适用。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（2d83e20），报告 4 项全过、人工审查通过（F-01 对照截图核对）。

## 视觉验证规范收紧：期望断言化 + 默认进基线 + 核对记录逐检查点

slug: visual-validation-guidelines

- 2026-09-05 问题记录（open）：上述三项缺口与修复方向（用户确认 1/3/4 开工；分步截图另立项 visual-interaction-step-shots）。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/visual-validation-guidelines）。
- 2026-09-05 开发完成（doing -> done）：三处 skill 文档落地——ai-visual-validation 视觉验证方法加第 4 条（弹层叠加/状态切换场景期望写「仍应在位清单」、禁「不遮挡/不覆盖」措辞）+ 新增场景示例注释同步；功能验收场景默认进 BASELINE_SCENARIOS（仅一次性调试 fixture 例外），两处「升级为基线」表述统一；worktree-dev-flow ledger notes 按检查点逐条记录核对结论。无 UI 行为变化，沙盒报告不适用；typecheck/test 495/build 全过。分支 agent/visual-validation-guidelines，done 标记 6ddbd5f。分步截图（interactSteps）另立项 visual-interaction-step-shots（open）。
- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（33d5855 rebase 后，与已合入的 interactSteps 段冲突已解）；文档类无 UI 行为变化，审查通过。

## 视觉验证流程加固：隐藏态场景 + 版式断言 + 布局改动全量 before/after

slug: visual-validation-hardening

- 2026-09-06 用户要求反思「为什么当时能过验」并确保不再发生 → 逐条归因 + 改进项，
- 2026-09-06 开发完成（doing -> done）：jump-latest-visible 场景（真实触发链）+ 三条 expect
- 2026-09-06 合入（done -> closed）：dev-merge 合入 main（复测 typecheck/568 单测/build 全过，dist 已重建）；用户主线 reload 实测通过（列居中对齐、jump pill、头部 preset chip 恢复）。

## 修正 vsce publish 发布已有 vsix 的命令写法

slug: vsce-publish-packagepath

- （无变更记录）

## Windows 上派生子任务/后台任务可能弹出终端窗口

slug: windows-subagent-console-flash

- 2026-09-04 用户报告 → 核实 dsh 0.1.1-rc.2 + 嵌套 node_modules 源码，定位根因在 dsh-subprocess-local 缺 windowsHide，dsh-one 侧启动链正确 → 记入 open/（未开始修改）。
- 2026-09-04 方案讨论确认：本仓库侧无干净修复路径、也不该 patch 全局 npm 包 → 关闭归档（open → closed），正文标注「等待上游」并记录验证步骤；上游修复发布后按验证步骤重验，需要时据此重开。

## workflow 运行卡无法折叠（点击不生效）

slug: workflow-run-card-cannot-collapse

- （无变更记录）

## 聊天流 workflow 运行卡片（run→phase→member）

slug: workflow-run-card

- 2026-09-01 认领（worktree: agent/workflow-run-card）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed

## workflow 进行中成员图标改成转圈

slug: workflow-running-member-spin-icon

- （无变更记录）

## 创建新 workspace 报 workspace-invalid-path：目标目录从未被创建

slug: workspace-create-missing-dir

- 2026-09-03 用户报 Windows 创建 workspace 失败 → 核实：dsh 0.1.1-rc.2 源码（dsh-workspace registry.create realpath 语义、host apiproxy 错误包装）+ 本机网关实测复现 → 根因是插件 `dshOne.workspace.create` 未建目录，非 Windows 特有 → 记录进 open/（未开始修改）。
- 2026-09-03 认领 → doing，worktree: agent/workspace-create-missing-dir
- 2026-09-03 开发完成（agent/workspace-create-missing-dir @ 7d5efdc：注册前 mkdir，typecheck/test 337 通过 + 真实网关端到端验证，dev-finish 自测通过）→ done
- 2026-09-03 主线合入（merge 7876d88，dev-merge 校验+复测 337 通过），确认 → closed

## Sessions 面板工作区分组过滤（tag + 下拉选择器）

slug: workspace-group-filter

- 2026-09-03 需求提出（用户：截图演示时工作区太多不方便）；讨论后确认 tag 多对多模型、下拉选择器交互、打标入口、全局持久化；设计稿在 `.dev-host/ws-group-tabs-mock-v1.png`（方案 B 下拉选择器）。未开始开发。
- 2026-09-04 打标入口确认放工作区右键菜单（见 `workspace-rightclick-menu`），本条目聚焦分组模型与下拉过滤。
- 2026-09-04 待决点全部拍板（用户确认）：① 开工节奏——与 `workspace-rightclick-menu` 各自认领、并行开发，本条目先合入（右键菜单「分组…」子菜单依赖本条目分组数据，故先做其非分组项并预留接口）；② 两条目不合并 worktree，各由独立 session 开发；③ 管理视图含打标（建组/重命名/删除 + 视图内勾选归组），本条目功能闭环；④ 分组顺序 = 管理视图内拖拽排序，空组保留显示（计数 0、可删除），重名拒绝、选中组删除回落「全部」。方案已拍板，可开工（认领动作由开发 session 执行 open → doing）。
- 2026-09-05 认领：worktree 开发 session（slug workspace-group-filter）开工，方案与拍板细节按正文执行。
- 2026-09-05 开发完成（doing → done）：分支 agent/workspace-group-filter，HEAD 34df8da，dev-finish 自测全绿（typecheck/build/456 tests/check-i18n 通过），质量门禁产物 `test/sandbox/verify.workspace-group-filter.report.html`（ledger：F-01..F-11 + R-01..R-03 全通过，截图内嵌）。实现：分组栏下拉选择器 + 「+」快速建组 + 管理视图（建组/改名/删除/拖拽排序/视图内打标）；数据模型（sessions.groups/groupMembership/activeGroup）存 globalState，纯层拆出可单测；本条目先合入主线，workspace-rightclick-menu 排其后（其「分组…」子菜单复用 workspaceGroupSetMembership/共享快照字段）。
- 2026-09-05 主线合入后人工确认（用户测试通过）→ closed

## 工作区右键「分组…」子菜单：hover 不展开 + 点击后顶层菜单消失

slug: workspace-groups-submenu-hover

- 2026-09-05 问题记录（open）：上述现象与根因；视觉测试在 main 复现（截图 /tmp/dsh-ui-shots/sessions-workspace-menu-groups.png 显示顶层菜单消失）。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/workspace-groups-submenu-hover）。
- 2026-09-05 开发完成（doing -> done）：popover 双层化——二级子菜单（showSubPopoverAt）独立于顶层菜单，点击「分组…」不再移除顶层 6 项菜单；「分组…」项改为 hover（pointerover）展开 + click 兜底（幂等不重建）；hover 移出时 140ms 延时收起子层。harness 场景重写（hover/click 两路径 + 移出收起 + 期望明确「顶层菜单并存」），hover 场景升级进 BASELINE_SCENARIOS；顺带校正归档禁用场景期望文本（tooltip 实际在锚点上方）。测试报告 test/sandbox/verify.workspace-groups-submenu-hover.report.html：8 项全 pass（harness 4 定制场景 + 124 场景全量回归 + 单测 495 pass），分支 agent/workspace-groups-submenu-hover，done 标记 c7075fd。无宿主链路改动，未跑沙盒 E2E（视觉场景即覆盖交互语义）。
- 2026-09-05 主线合入后人工确认（监控验收通过）→ closed

## 空会话 hero 工作区 chip 只读，不能切换/新建工作区

slug: workspace-picker-blank-session

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + test 253 + build 全绿）→ done
- **host 链路实测全部可用**：`workspace.list` / `workspace.create {path}` / `session.create {workspaceId}`（复用/新建 blank 会话）/ `workspace.delete`（对 127.0.0.1:3080 网关实测；`dshRpc.ts` 已有 `listWorkspaces` / `ensureWorkspace` / `ensureSession` / `createSession` 封装）。
- **切换语义对齐官方 connectWorkspace**：选 workspace → 复用该 workspace 已有 blank 会话（`blank && sessionIds 包含 && 未归档`），没有则 `session.create {workspaceId}` → `sessions.open`（dsh-one 的 `openSession`）。官方 picker 行 = 文件夹图标 + title + 当前项对勾，无路径/计数；footer 分隔线 + 添加入口。
- **web 版 DirectoryBrowser 不可行（host 侧限制）**：它依赖 `host.listDirectory` / `host.createDirectory`（browse 能力），当前 dsh host 组合是 native 能力，实测返回 `directory-picker-unavailable`（`host.pickDirectory` 是 dsh 进程自己的 OS 对话框，无法嵌入 webview）。**用户已确认**：hero picker 的「添加工作区」用 VSCode 原生目录对话框（复用 `dshOne.workspace.add` / `dshOne.workspace.create` 命令，两个入口与侧栏一致）。
- `src/pure/chatContract.ts`：ChatState 加 `workspaceId`（当前项对勾）+ `workspaces`（picker 列表投影）；FromWebviewMessage 加 `workspacePick` / `workspacePickAdd` / `workspacePickCreate`。
- `src/ui/sessionsStore.ts`：暴露 `workspaceBaseline` getter（workspace.list 基线）。
- `src/ui/chatView.ts`：composeHeader 合成 picker 数据（随 store 刷新重推）；onMessage 处理三个新消息——`pickWorkspace`（基线找 workspace → `ensureSession` → `openSession`）、`addWorkspaceAndOpen` / `createWorkspaceAndOpen`（executeCommand 复用侧栏命令，命令返回注册的 WorkspaceView 后切换过去）。失败提示 warning，取消静默。
- `src/extension.ts`：`dshOne.workspace.add` / `dshOne.workspace.create` 改为返回注册的 workspace（侧栏调用方忽略返回值，无行为变化）。
- `src/ui/chat/webview.ts`：hero workspace chip 改 button + chevron（aria-haspopup），点击弹 `openWorkspacePicker`（popover：workspace 行 + 对勾 + footer 两个添加入口；列表为空时只剩添加入口——官方空列表直接进目录流程，这里退化为只弹添加入口，不自动弹系统对话框）。
- `src/ui/chatView.ts` CSS：`.workspace-item-label`（省略号）+ `.workspace-picker-footer`（分隔线，对齐官方 Menu footer）。
- `test/ui/scenarios.js`：empty 场景更新（chip 可点）+ 新增 `workspace-picker-open`（picker 打开态）与 `workspace-picker-empty`（无 workspace 只剩添加入口）场景。
- 复用判定补齐 `s.cwd === workspace.path`（与官方一致）；
- 命中复用后直接返回 sessionId，**不再调 session.create**——只有找不到可复用 blank 时才 `session.create { workspaceId }`（host 端 cwd 即 workspace.path，无冲突路径）。
- **点击 chip 只记 pending**：`pendingWorkspaceId` 记录目标 + 重推 state（composeHeader 用 pending 覆盖 workspaceLabel/workspaceId，chip 与对勾显示目标），**零 RPC、不换 controller**——点击瞬时完成。点当前显示项 = 取消（目标等于当前所属 workspace 时清标记）。
- **发送/选 preset 时落地**：`send`、`setAgentPreset` 分支先 `resolvePendingWorkspace()`（ensureSession + openSession 切换）再执行——等待移进发送动作本身；失败提示并中止该次操作，pending 清除、chip 回退。
- **附加**：添加/创建工作区命令成功后 refresh 基线再设 pending；attach（换会话）、服务停止时清 pending。
- **webview 零重建**：`composerSig` 移除 workspaceLabel（pending 帧只改 chip 文字，不进 composer 签名）；hero 保活分支就地 patch workspace chip 文字（草稿、焦点、IME 不中断）；picker 行点击不再拦截当前项（统一 post，宿主判断取消）。
- 2026-09-02 主线合入（merge 47d161f）并回归通过（typecheck + 298 test + build 全绿），人工 dev-ui-test 验收通过 → closed

## 工作区右键菜单（引用文件夹 / 分组打标 / 归档等）

slug: workspace-rightclick-menu

- 2026-09-04 需求提出（用户：session 参考另一工作区结构，右键直接引用工作区文件夹；确认按会话「复制引用」同款方式）。讨论后确认菜单清单与不做项；打标入口并入本菜单（前置 `workspace-group-filter`）。未开始开发。
- 2026-09-04 方案确认（与用户逐项拍板）：菜单清单定稿 6 项，hover 按钮现状全部保留（右键菜单为并存入口）；核实宿主源码——@ 引用无「注入目录结构」步骤、fs 工具绝对路径可用，降级方案保留「失败退化复制纯路径文本」；开发节奏：与 workspace-group-filter 分两个 worktree，先做 group-filter 合入后本条目再开工。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/workspace-rightclick-menu）。开工前实测 @/abs/path 引用（结论见变更记录后文与测试报告）。
- 2026-09-05 开发完成（doing -> done）：6 项菜单全部落地（复制文件夹引用/分组…/归档该工作区全部会话/在新窗口打开文件夹/复制路径/从列表移除）。@/abs/path 实测通过（宿主网关探针：工作区外绝对路径被模型 read 工具成功读取，宿主未启用工作区外 fs 限制）→ 不退化为纯路径；分组… 子菜单复用 workspaceGroupSetMembership（勾选就地翻转，修掉快照往返竞态）；归档复用 openArchiveModal（从多选归档抽出）+ sessionArchiveMany → archiveManyDone。测试报告 test/sandbox/verify.workspace-rightclick-menu.report.html：11 项全 pass（harness 4 新场景 + 116 场景全量回归 + 沙盒 E2E 8 步全过 + 全量单测 470 pass + i18n OK），分支 agent/workspace-rightclick-menu，done 标记 0284273。
- 2026-09-05 主线合入后人工确认（用户验收通过）→ closed

