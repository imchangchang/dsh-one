# 聊天渲染扩展性：缩略图请求风暴 + 虚拟化 + undo 栈

## 背景与现象（2026-09-04 评审原始记录，下文「重新核实」以当时代码为准并纠正过时描述）

评审确认（P2，非阻塞）：
- 消息列表全量渲染（无虚拟化）：含几十/上百张图片文件的大会话初始渲染瞬间打 N 个 requestFileThumb，webview↔宿主通信风暴（fileThumbRequested 只拦重复不拦首发，已加失败重试）
- composer 输入框透明文字+高亮层方案固有代价：undo 栈被手改 value 破坏（删除 token 后 Ctrl+Z 不可恢复）；选中反馈已用 ::selection 底色缓解
- 气泡 hover 委托（mouseover 清+重设）在跨子元素时抖动

## 开发前重新核实（2026-09-09，按当时 main 代码逐项复测，行号为 2026-09-09 快照）

### 1. 缩略图请求风暴 —— 仍存在，且有两个原文未提到的新事实

**现状（代码）**：`src/ui/chat/webview.ts` 三处渲染即发请求，无可见区挂钩、无批处理：
- L3696-3704 `fileChip()`：窗口内每个未缓存 image 文件在渲染时立即 `post({type:'requestFileThumb'})`；重试由 `fileThumbRequested` Map（L339-340）按 `Date.now()` 间隔控制
- L5831-5836 `pendingFileChip()`（composer 附件同款懒加载）
- L3656-3659 `messageImageThumb()`：内联 image 附件走 `requestAttachment`，同样无可见区过滤（原文只提了 requestFileThumb，漏了这条通道）
- host 侧 `src/ui/chatMessages.ts` L612-624：每个请求 `fs.readFile` **完整文件**转 base64 回传——不是缩略图，大图单请求可达 MB 级；`requestAttachment` 走网络取字节（L790-799），同样无并发上限

**实测**：mock 状态 41 个图片文件，一次渲染即发 **42 个 requestFileThumb**（41 文件 + 2 个 hover 测试文件扣除 1 个），无任何可见区拦截。

**过时点**：
- 「初始渲染瞬间打 N 个」不准确：初始窗口只有尾 50 条消息（`src/pure/historyWindow.ts` `HISTORY_WINDOW_MESSAGES=50`，L10），N = 当前窗口内图片数；几十上百图需要翻页（loadEarlier 每页 50 条，`src/server/chatSession.ts` L651-696），**每翻一页再打一批**。
- 「已加失败重试」描述不足：重试是**无限 5 秒重试**（文件缺失时流式渲染下每 5s 重发一次，永不放弃；`fileThumbRequested` 只存时间戳、不记失败状态）。

**方案与成本**：两级，建议先做 host 侧（纯 host 改动、零 DOM 耦合、风险最低）：
- A1（host 侧限流+收敛，~1 天）：requestFileThumb/requestAttachment 串行队列 + 并发上限（2-4）+ 失败文件标记（1-2 次重试后放弃，不再无限 5s 重发）
- A2（webview 可见区挂钩，~1-2 天）：IntersectionObserver。注意每帧全量重建（见第 2 条），observer 需每帧重挂——与 A1 相比收益是省掉不可见图的请求，成本更高；建议 A2 只在 A1 后实测仍嫌带宽/内存才做（若做，观察点放 `fileChip`/`messageImageThumb` 返回的占位元素）

### 2. 消息列表虚拟化 —— 「大语义改动」结论不变；新增更便宜的中间方案（增量更新）

**现状（代码）**：
- 窗口机制：附着只拉尾窗 50 条，loadEarlier 每页 50 条向前翻（同第 1 条）；`state.messages = folder.messages()`（chatSession.ts L428）全量透传给 webview
- 渲染：webview.ts L3034 `messages.textContent=''` + L3045 `appendMessageFlow(messages, state)` —— **每个快照全量重建全部消息 DOM**；快照节流 `FLUSH_INTERVAL_MS=100`（chatSession.ts L47），流式时 ≈10Hz 全量重建。实测 42 条简单消息 = 641 个 DOM 节点（真实消息含 markdown/代码/操作栏会放大数倍）
- 需与虚拟化协调的既有机制：workflow run 卡按 anchorSeq 插进消息流（webview.ts L4306-4321）、顶部「加载更早」入口、尾部 turn status/steering 气泡、prepend 锚定补偿（L3148-3158，靠真实 scrollHeight 差）、per-session 滚动存档、jump-latest、异步图片/详情高度

**重估**：虚拟化仍是**大改动**，理由未变且新增一个交互点——消息高度可变（markdown/代码/异步图片），窗口化需总高度模型 + 逐项实测高度，并与 prepend 锚定（加载更早补偿 scrollTop）深度交织。**但帧成本的主体是「每帧全量重建」而非 DOM 总数量**：更便宜的中间方案是先做**增量更新**（按消息 id/seq diff，只重建变更消息），中等改动、风险低于虚拟化，与现有滚动锚定机制兼容（不改变 DOM 总量语义）。建议：虚拟化降级为「增量更新后长会话实测仍卡才做」。

### 3. undo —— 问题仍存在；方案降级：不做 contenteditable 迁移，改用 execCommand('insertText')

**现状与实测**：composer 仍是透明文字 textarea + 高亮叠层（webview.ts L5874/5899，`#input` color:transparent 见 `chatViewHtml.ts` L1365-1379，IME 组合层修复在 webview.ts L6198-6211：组合期间隐藏叠层、恢复文字色）。约 20 处程序化 `input.value=`（交互插入：L1594/1653/1712/1750/2378；还原/清空：L5893-5896/6014/6029/6046/6102/6152/6181-6186/6276；goal/queue 编辑器等）。

实测（Chromium，webview 同引擎）：输入 `hello` → 程序化 `.value=` 追加 token → 再输入 `world` → Ctrl+Z 一次回到 `hello@tok `，**再 Ctrl+Z 无效果**——程序化写值清空浏览器 undo 历史，插入点之前的内容不可恢复。**问题确认仍在。**

**方案与成本**（性价比反转）：
- 交互插入类写值改为 `document.execCommand('insertText')`（Chromium/Electron 仍支持，textarea 上有效；实测该方式把插入记入 undo 历史）。约 6-8 个交互点（@ 候选 L1653、mention 补全 L1594、session 候选 L1712、slash 补全 L2378、粘贴回填 L1572 等），每点 2-3 行，半天完成
- 还原/清空路径（recall、draft 恢复、clear-all、发送后清空）保持 `.value=`——这些本来就不应进入 undo
- **contenteditable 迁移：砍掉**。代价大（selection/序列化/键盘/IME 全套重写），且会推翻刚修好的 IME 组合层机制（L6198-6211），收益（undo + 去掉透明文字 hack）已被 execCommand 挡掉大半
- 开发注意（实测发现的坑）：Chromium 会把**连续** execCommand insertText 合并为一个 undo 组（一次 undo 撤销整批）；真实键盘输入与程序化插入的分组边界需开发时用真实输入验证一次

### 4. 气泡 hover —— 原描述过时：间隙穿越抖动不复现；真实残留是流式重建丢高亮

**现状（代码）**：webview.ts L4217-4232 行级委托。关键：`mouseover` 目标**不是** ref chip 时直接 return（不清除）——穿越 chip 间隙时高亮**保持**；`clearRefHighlight()` 只在再次进入 chip（或其子元素）时执行，同步 clear+re-add，同一事件处理器内完成，无中间绘制帧。

**实测**（合成 mouseover + MutationObserver，对手 chip A/B + 附件 chip）：
- A → 间隙文本 → B 穿越：`.ref-chip.ref-hover` / `.hovered` 全程保持（间隙步无清除）——**原文「跨子元素时抖动」未复现**
- 进入 chip 的子元素（svg/span）：clear+re-add 同步完成（20 次 class 变更，无可视中间态）
- **真实残留（已复现）**：流式快照每帧全量重建 DOM → 重建后高亮丢失（实测重投 state 后 `ref-hover`=null、`.hovered`=[]），鼠标不动就保持丢失、动一下才恢复 → 流式中 hover 高亮闪烁/消失。这才是当前实际的「抖动」形态（全量重建是根源）

**方案与成本**：条目原方案（缓存当前高亮 path，同 composer `hoverTokenPath` 模式 webview.ts L5935-5949）仍然正确，且要补一步：**render 重建后按缓存 path 恢复类**（原来只需防间隙清除，现在主用途变成防每帧重建丢失）。~15-25 行，半天内，低风险。

## 建议拆分（核实后更新）

- **A 批（低风险，先做）**：缩略图 host 侧限流/失败收敛（A1） + hover 缓存恢复 + undo execCommand 改造——均为小改，可一并对齐验收（~1.5-2 天）
- **B 批（中等）**：消息渲染增量更新（diff 重建），与 A 批无依赖；实测长会话仍卡时再评估虚拟化
- **虚拟化**：保留为「增量更新后仍不足」的后手，暂不排期；确认评审「大语义改动」结论未变
- A2（可见区 IntersectionObserver）视 A1 后实测带宽/内存表现决定是否补做

## 变更记录

- 2026-09-08 代码评审确认后建条目 → open
- 2026-09-04 主 session 拍板：四件全做（含虚拟化与 undo 迁移，不裁剪）；排期后置；开发前按当时代码重新核实 → 条目更新（仍 open/）
- 2026-09-09 开发前重新核实完成（按当时 main 代码逐项复测）：①风暴仍存在（新增：无限 5s 重试、requestAttachment 同款无过滤、host 读全文件非缩略图）；②虚拟化仍是大改动，新增更便宜的增量更新中间方案；③undo 问题确认仍在，方案降级为 execCommand insertText、砍掉 contenteditable 迁移；④hover 原描述过时（间隙抖动未复现），真实残留为流式重建丢高亮；更新拆分建议 → 条目更新（仍 open/）
- 2026-09-05 与 dsh-0.1.2-interaction-gaps 合并规划（用户拍板）：原 Sprint 4 + Sprint 5 合并为一个「chat 面板改造」序列，阶段表见下；本条目为主，interaction-gaps 条目同步标注。虚拟化=后手（长会话实测仍卡再做）。

## 合并阶段表（2026-09-05 拍板）

| 阶段 | 内容 | 量级 |
|---|---|---|
| 1 地基小修 | host 限流+失败收敛（缩略图/requestAttachment）、hover 缓存恢复（流式重建丢高亮）、undo 改 execCommand 保撤销链 | ~2 天，小改 |
| 2 渲染基建 | 消息列表增量更新（按 id diff，替代每帧全量重建） | 中等 |
| 3 P1 功能 | token 用量明细（药丸+弹窗，host 聚合 turn-usage）、回合导航（turnOutline 投影+轨道栏+跳转） | 低-中 |
| 4 P2/P3 | 字号调节（CSS 变量链）、定时计划 chip（schedule 投影）、整轮聚合折叠（可选） | 低-中 |
| 后手 | 消息列表虚拟化 | 大改 |

阶段 1 可拆 2-3 个 session 并行（host 侧限流 vs webview 侧 hover/undo 不冲突）；阶段 2-4 同区域（webview 渲染路径）串行。
