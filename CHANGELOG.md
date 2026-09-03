# Change Log

## [1.0.0]

### Fixed

- 插话（⌘/Ctrl+Enter，等待落地的 steering 消息）气泡只渲染纯文本：附件显示成「[图片 ×1] [文件 ×1]」计数前缀、会话引用显示原始 `@[标题](dsh-session:…)` markdown。现在与正式用户消息共用同一套渲染——host 从 queue 帧内容提取图片（attachmentId）与文件（`<attachment>` 行）随快照下发，webview 剥附件行、把 canonical mention 展开成可读 `@label`，气泡渲染图片缩略图、文件 chip、会话引用 chip 与「引用会话 · …」摘要行；行结构不变（气泡左侧处理中圆圈）。

- 窗口 reload / VSCode 重启后已打开的 tab 全部丢失（会话 chat tab 与 `DSH One: 在编辑器标签页中打开` 的 dsh web tab）：注册了 WebviewPanelSerializer（`dshOne.chatPanel` + `dshOne.tab`）。会话 tab 以创建后不变的 tabId 为恢复凭据——webview 内容经 `acquireVsCodeApi().setState` 保存，真实会话经 workspaceState 的 tabId → sessionId 映射查询（tab 打开/关闭/会话替换时增量维护），reload 后按 VSCode 还原的面板（位置/active 不变）重建：服务运行中直接附着 controller，未运行先显示空态、服务恢复后走既有 lastActive/pendingRestore 链补附着；dsh web 面板重新绑定服务状态并刷新内容。用户手动关闭的 tab 不恢复，会话数据本身不受影响（dsh 服务与 VSCode 生命周期解绑，此前已如此）。

- 切换会话时先闪一帧空会话 hero（「服务未就绪，暂时无法发送」的居中排版）再跳成消息流：根因是 session.history 基线翻页期间 getState 已带 sessionId 但消息为空、canSend 为 false，命中了空会话 hero 分支。ChatState 新增 `loading`（历史基线未就绪时为 true），加载期间只显示「加载会话…」居中占位，hero 与消息流都等基线落地再渲染。

- 旧会话的聊天头部不显示 preset 标签：原实现靠扫会话日志里的 agent-preset/selected 事件，创建时指定 preset 的会话没有这条事件、旧会话也可能翻不到。改为对齐官方 AgentPresetLabel 的渠道——`composeHeader()` 从 session.list 基线取附着会话的 agentPreset id（官方 sessionSummarySchema 字段，host 创建时即定、实测 77 个会话全部有值），经 roster（agentPreset.list）映射成显示名：user preset 显示 roster 的 name 而非裸 id，roster 未就绪或未知 id 回退已知 system id 中文名/原样 id；roster 拉取不再局限于空会话，store 刷新时标签随之更新。后台任务 chip 的 mux 渠道经核对即官方 web 客户端同款（dsh-client-connection 的 openMux → /api/events.mux 的 session/jobs 帧），未改动。

- 会话行首三种标记（运行中像素环/未读蓝点/置顶图钉）位置不对齐、图钉偏小：状态槽加宽到官方 dsh web 的 16px，三种标记统一收进槽内同一位置居中（优先级 运行中 > 未读 > 置顶），图钉从 11px 放大到 13px；组合状态（置顶 + 运行中/未读）时被挤出槽位的图钉退到标题前。

- 会话行首的「运行中」标记与官方不符（原来是绿色小圆点、空闲会话也有灰点）：对齐 dsh web 官方 StateDot——运行中改为 8 格像素环追逐动画（deepseek 蓝，1s 错相旋转），空闲会话行首留空不再画点。

- turn 失败（如模型上下文超限返回 401）时界面只显示一条空 assistant 消息、看起来像没回复：现在按 dsh web 官方样式显示「本轮运行失败」错误行（红点 + 错误 message + 可选 code 角标），错误来自 host `turn/end` 的 error reason。

- 会话列表的相对时间（"N 分钟前"）长时间不刷新：新增 60s 本地 tick，用缓存基线纯重建模型（不发 RPC）更新时间文案。dsh web 官方同样不轮询（渲染时取一次当前时间），此处是超出官方行为的体验修正。

- 新会话被 dsh 自动命名后，会话列表里的标题不更新：自动命名经会话内的 title 投影到达，host 事件流没有对应事件，面板收不到刷新信号；现在附着会话的标题投影变化时会主动重拉一次列表基线。

- 流式输出期间用户展开的折叠块（思考过程、工具输出、注入上下文、问题详情）不再被快照重建冲掉：`<details>` 的展开状态按消息/块位置持久记录，重建后恢复；切换会话时清空。

- 流式输出期间点击权限/模型等弹层会被快照重建冲掉：弹层现在跟随锚点存活（锚点被重建才关闭，布局移动时重新定位），锚定在输入区内的弹层会钉住 composer 不被重建。

### Changed

- 空会话 hero 的 preset（Agent 模式）与权限模式切换改为**懒更新**（与 workspace 懒切换同模式）：点选只记录 pending 并就地更新 chip/pill 显示，**不发 RPC、不执行 /permission 命令**——真正 `setAgentPreset` / `/permission` 在发送时随消息一起落地。此前切换 preset 会触发 hero 整页重建（鲸鱼动画重播、chip 是 popover 锚点被换掉）；切换权限模式的 `/permission` 命令会直接写进消息流，把空态 hero 变成「输入过问题」的消息流 tab。修法：`agentPreset`/`permissions` 移出 composer 签名、hero 保活分支就地 patch（对齐 workspaceLabel 的既有做法）；`ChatTabHost` 增加 `pendingPresetId`/`pendingPermission`，由 `composeHeader` 覆盖显示、send handler 统一落地。

- 聊天输入区的发送按钮对齐官方 dsh web（hero 空态与普通消息流一致）：文字「发送」按钮改为 34×34 圆形图标按钮（品牌蓝 `deepseek-400/500` 底、白色 16px 上箭头图标、无文字、disabled 半透明）；运行中同一按钮变停止方块图标（官方 primaryStops 交互），点击即停止——原来并排的独立「停止」文字按钮移除；排队发送仍走 Enter（⌘/Ctrl+Enter 插话）。图标取自官方 InputBar 主按钮内联 path（`IconSendOutline16` 发送箭头、`<rect rx=3>` 停止方块）。

- 「发送到当前会话」右键菜单项改为 `DSH One: 发送到当前会话`（标题自带 DSH One 标识，右键菜单不显示 category，不加前缀看不出是谁的菜单）：编辑器/资源管理器菜单里的位置从最顶的 navigation 组移到中间独立分组 `2_dshOne`（与相邻分组自动以分割线隔开）；添加成功后的右下角提示移除（composer 里出现的附件 chip 本身就是反馈，不再弹 toast）。

- 会话面板的 workspace 标识与 dsh web 融合：当前 VSCode 打开的 workspace 行尾标签从「当前」改为「vscode」（语义不变，只是标明"这个文件夹开在 VSCode 里"）；附着会话所在 workspace 的文件夹图标染 deepseek 蓝（对齐 dsh web 官方标识），折叠组同样生效，随附着会话切换实时跟随（复用 syncSessionHighlight 的免重建通道，凭组元素上的 workspaceId 回查快照模型）。

- 空会话（还没有任何消息）的聊天区改为官方 dsh web 空态的居中排版并做本地化定制：居中 DSH One 像素鲸鱼 logo（品牌蓝 #2563EB，约 64px，像素图形取自 assets/icon.svg，轻量游动动画；不用官方 dsh 的鲸鱼标）；无「探索未至之境」标题与「预览版」徽章（用户要求去掉）。其下一行 chip——workspace 名（文件夹图标 + 名称 + 可点开的选择器，来自 workspace.list 基线）和 preset 选择 chip（从 composer 底部挪入，交互不变，下拉向下展开），再下是居中的大圆角 composer 卡片（max-width 780px 自适应收缩、22px 圆角、浮层底色、柔和双层阴影，placeholder 对齐官方「描述你想要构建的内容」，输入字号 16px/24px）。一旦有了消息或 turn 进行中即恢复常规的消息流 + 底部 composer 布局；原「会话还没有消息」提示随之移除（被 hero 取代）。

- 聊天头部样式逐项对齐官方 dsh web 会话头部：标题从 13px/600 改为 14px/20px/500（官方 crumbCurrent），头部 padding 加大（12px 12px 8px）、元素间距 8→10px；「N 个子代理」「N 个后台任务」chip 从徽章底色改为透明底小字（12px，descriptionForeground），文字版「⌄」换成官方 IconChevronDownOutline14 矢量图标，hover 只提亮文字不再整片变亮；只读 preset 标签改为独立的浅底胶囊（22px 高、圆角 6px、最大宽 160px 截断），前置官方 IconAgentPresetOutline16 三环图标（14px、70% 不透明度）。

- 左栏顶部「会话 | 任务」tab 与任务看板界面移除：后台任务的入口收敛到聊天头部的「N 个后台任务」chip（对齐官方 dsh web 形态），看板专属的「显示全部」勾选、详情面板、ActivitySnapshot 推送链路一并删除；jobsStore 的 mux 数据链路保留，改供头部 chip 使用。

- Sessions 树视图合并进 Chat 面板（原生 tree view 移除）：宽屏（≥720px）为左右两栏（左会话列表 260px、右聊天），窄屏改上下布局（会话列表在上、限高 40% 自滚动）。搜索框、排序切换、刷新、新建 workspace/会话、重命名/归档、打开文件夹等操作全部移至面板内；服务未运行/未安装 dsh 的空态与启动、安装引导按钮也随之迁入面板。

### Added

- 编辑器与资源管理器右键文件新增「发送到当前会话」（`DSH One: 发送到当前会话`）：把当前文件作为附件暂存到当前 Chat 面板活跃会话的 composer，与点「添加附件」等价——图片走图片附件（48px 缩略图 + 会话图片限额校验），其他文件以路径 chip 暂存，发送时以 `<attachment>路径</attachment>` 拼进 prompt 让 agent 自己读。没有附着会话时自动附着当前 workspace 最新的会话，一个都没有则新建；Chat 面板没打开过也不丢（附件先落 host 队列，视图 resolve 后再投）。右键目标优先取菜单上下文（explorer 的 Uri / editor 的 resourceUri），编辑器内右键兜底用当前活动编辑器。

- 会话面板的 workspace 行 hover 操作新增「在终端中打开」图标（终端样式，+ 号旁）：点击后以该 workspace 文件夹为 cwd 新建 VS Code 终端并显示，终端名为文件夹名；当前/非当前 workspace 均可用。

- 聊天头部新增「N 个后台任务运行中」chip（对齐官方 dsh-client-ui-jobs 的 JobListAction）：附着会话有后台 job 时出现（有运行中的显示运行中数并带像素环，全部结束显示「N 个后台任务」），点击弹下拉——每行状态点（运行中像素环/已完成绿/已取消琥珀/已失败红）+ kind 徽标（bash 等）+ 命令摘要 + 状态文案（host detail 优先，如 "exit code: 0"）+ 耗时（23秒 / 4分58秒 / 1小时2分，运行中的打开下拉后 1s 跳动），已结束行淡化；行序为运行中在前（开始时间升序）、已结束在后（完成时间降序）。数据复用 jobsStore 的 mux 全局 session/jobs 帧，实时刷新。

- composer 待发送附件列表对齐官方 AttachmentRail：图片附件从文字 chip 改为 48px 圆角缩略图（object-fit: cover，直接用内存里的 data: URL 渲染，CSP 已允许 img-src data:，未引入 objectURL），点击缩略图放大预览，hover 右上角出 × 移除（触屏常显，reduced-motion 去过渡）；加载失败回退为原文件名 chip。文件附件 chip 保留真实文件名并加文档小图标；多个附件横排、超出换行。

- 会话菜单（⋯/右键）新增「标为未读 / 标为已读」：未读是纯客户端状态（官方 dsh 无未读概念与 API），与置顶一样持久化在 workspaceState；未读会话行首显示蓝色圆点（运行中时被像素环占用，仍有标题加粗兜底）且标题加粗，打开（附着）会话自动清未读。官方同样没有自动未读逻辑，故只做手动标记。

- 聊天头部信息区对齐官方 dsh web：标题后新增「N 个子代理」chip（附着会话正在运行的 continuable 子代理，点击弹下拉——每行标题 + 相对时间/token 用量摘要，行点击附着子会话；无运行中子代理时不显示）和只读 preset 标签（如「标准模式」，来自 session.list 基线的 agentPreset 字段，与空会话 hero 里的选择 chip 互斥）。头部标题过长仍 ellipsis 截断，但 hover 显示完整标题，chips 不再挤压标题（flex:none）。

- 对话排版向 dsh web 官方 / kimi-cli 靠拢：工具调用从卡片容器改为行式排版——状态图标（成功 ✓ 绿、失败 ✕ 红、运行中旋转圈）+ kimi-cli 风格英文动作短语（bash→"Ran a command"、read→"Read <路径>"、write→"Using Write" 等，未知工具回退原名）+ 等宽命令/参数预览行（bash 类带 `$ ` 前缀、截断省略）；工具输出默认只显示前 5 行 + 「… 共 N 行，点击展开」提示（点击展开全部、再次点击收起，展开状态跨流式重建保留）；思考过程保持可折叠并改为灰色小字。
- 「Deep diving...」状态行的扫光改为蓝色系渐变（对齐官方 deepseek 蓝，深/浅主题通用），15 秒后的耗时计时逻辑不变。

- 空会话（还没开始任何 turn）出现 Agent preset 选择 chip（最初在 composer 底部模型 pill 旁，后随空态 hero 排版挪到 hero 标题下的 chip 行）：点击弹下拉，一行一个 preset（名称 + 描述，官方四个 system preset 用中文文案：标准模式/PTC 模式/极简模式/创造模式；user preset 用 roster 自己的 name/description），当前选中打勾。选择走主机 agentPreset.select；会话开跑后 host 即锁定（agent-preset-locked），chip 随之消失。

- 对话框右下角的上下文容量条按余量变色并给出实时预估：以 sessionStats 的轮数估算平均每轮上下文增长（perTurn = usedTokens / turns），换算剩余轮数（向下取整）；剩余 ≥10 轮绿色、<10 轮黄色、<5 轮红色，turns < 1 或无法估计时按充足处理。切到更小窗口的模型导致已用量超限时直接红色（与轮数无关），bar 悬停提示与点击弹出的面板里都有超限说明（建议先切回之前的模型执行 /compact 压缩，再切换模型）；面板在可估计时追加一行预估「≈N/轮，约还可持续 M 轮」。

- 发送后等待模型响应期间（turn 打开、尚无输出）在对话流末尾显示状态行「Deep diving...」（对齐 dsh web 官方 TurnStatus 的渐变闪烁动画），超过 15 秒右侧追加每 1 秒跳动的已耗时（如 1m23s）；turn 结束即消失。
- 初始版本：运行时按需下载（Node + dsh）、dsh web 服务管理（探测/复用/spawn/清理）、侧边栏与编辑器标签页内嵌官方 UI、状态栏、自动更新。
- Sessions 侧边栏支持按标题/会话 ID 搜索过滤，以及排序切换（最近更新优先 / 最早更新优先 / 按标题），排序偏好持久化。
- 对话消息级操作：助手消息下方可复制全文、标记有用/没用（对接主机 messageFeedback）、从已完成轮次创建分叉会话；操作行与 dsh web 端图标风格对齐。
- Sessions 视图：标题栏 + 号菜单可添加已有文件夹、或输入名称在 `~/.dsh/workspaces/` 下创建工作区（自动建目录并注册到 dsh；dsh 全局目录不存在时明确报错）；新建会话的 + 移到每个 workspace 行的内联按钮。
- 未安装 dsh 时，Sessions 欢迎页与 Chat 空态显示安装引导，一键打开官方安装页面（deepseek.com/harness）。
- Sessions 面板：元素对齐 dsh web 自身实现——workspace 分组行点击折叠/展开（文件夹图标与 hover 三角箭头、固定行高），会话行 hover 出「⋯」菜单（重命名/置顶/分叉会话/归档会话，带官方图标），右键弹同一菜单；置顶为本地偏好（持久化在 workspaceState，置顶会话排在分组最前），分叉复用主机 session.fork。会话面板与聊天区改用不同背景色（sideBar / editor）区分。
