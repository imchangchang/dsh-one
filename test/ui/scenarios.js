// Webview 场景目录（chat webview + 侧栏 sessions 面板）。每个场景定义一个 UI
// 渲染输入（state / sessions / modelCatalog），harness.html 按 ?scenario=<name>
// 选取并推给 webview，得到对应的界面状态。
// 用途：视觉回归 / UI 改动验证 —— 各种状态（含边角、错误态）都能确定性渲染、截图。
// 只增不改字段名；新增场景往 window.SCENARIOS 里加一个条目即可。
// 侧栏面板场景（view: 'sessions'）只投喂 sessions 快照；interact 字段是一段 JS
// 字符串，快照投喂后延迟执行，用于打开菜单/进入行内重命名等交互态再截图。
(function () {
  const UNGROUPED = '__ungrouped__'
  const rid = (p) => p + Math.random().toString(36).slice(2, 7)

  // ---- 消息/区块构造器 ----
  const u = (text) => ({ kind: 'user', id: rid('u'), text })
  const at = (text, extra) => ({ kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, blocks: [{ type: 'text', text }, ...(extra || [])] })
  const toolBlock = (over) => ({ type: 'tool', callId: rid('t'), name: 'bash', status: 'done', title: 'bash', detail: 'npm test', output: '7 passed, 0 failed', ...over })
  // 一条已完结的 subagent 工具调用卡（fork 快照里的占位结果 / 正常会话里的历史调用）。
  const subagentBlock = (subagentId) => toolBlock({
    name: 'subagent', title: '子代理', detail: undefined,
    args: JSON.stringify({ description: '调研会话 fork 行为', prompt: '请总结 dsh-one 的 fork 行为。', run_in_background: true }),
    output: `started subagent ${subagentId}`,
  })

  // ---- 侧栏会话树快照构造器 ----
  const sess = (sessionId, label, description, over) => ({
    sessionId, label, description, running: false, pinned: false, unread: false, descendantRunning: false, hasCompletedTurn: true, ...over,
  })
  window.sessionsTree = function (activeId) {
    return {
      query: null,
      sortOrder: 'updatedDesc',
      serverState: 'running',
      dshNotFound: false,
      pinned: [],
      collapsed: [],
      unread: ['sess-2'],
      activeSessionId: activeId ?? null,
      attachedSessionId: null,
      contentSearchHasMore: false,
      contentSearchError: false,
      workspaces: [
        {
          workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', label: 'dsh-one', isCurrent: true,
          sessions: [
            sess('sess-1', 'DSH One 示例会话', '3 小时前'),
            sess('sess-2', '重构 sessionStore', '5 小时前', { unread: true }),
          ],
        },
        {
          workspaceId: 'ws-research', path: '/Users/cgeng/Workspaces/dsh-web', label: 'dsh-web research', isCurrent: false,
          sessions: [
            sess('sess-3', 'dsh web 可展开 UI 调研', '昨天'),
          ],
        },
        { workspaceId: UNGROUPED, path: '', label: '未分组', isCurrent: false, sessions: [] },
      ],
    }
  }

  // ---- 基础 ChatState，供各场景覆写 ----
  const base = (over) => ({
    sessionId: 'sess-1',
    sessionTitle: 'DSH One 示例会话',
    messages: [
      u('你帮我看看这个插件的架构，总结一下核心思路。'),
      at('这个插件是 **dsh 与 VSCode 的桥接**：定位本机 dsh，从 VSCode 启动或复用 dsh web 服务，并把 dsh 界面以 webview 形式内嵌到侧边栏。'),
    ],
    pending: [],
    running: false,
    canSend: true,
    modelLabel: 'DeepSeek-V4-Flash High',
    presetLabel: '标准模式',
    statsLine: '2 条消息 · 45s',
    ...over,
  })

  // 每个场景 = { state, title, expect }（+ 可选 view/interact）：
  //   view    — 'sessions' 时加载侧栏面板 bundle（只投喂 sessions）
  //   state   — ChatState / SessionsSnapshot 渲染输入（见 harness.html）
  //   interact — 投喂后执行的交互 JS（如模拟点击打开菜单）
  //   title   — 显示名（给 agent / 人看）
  //   expect  — 该状态应该呈现的逻辑与排版（agent 读截图后逐条对照核对，非像素 diff）
  const catalog = {
    conversation: {
      state: base({
        messages: [
          u('你帮我看看这个插件的架构，总结一下核心思路。'),
          at('这个插件是 **dsh 与 VSCode 的桥接**：定位本机 dsh，从 VSCode 启动或复用 dsh web 服务，并把 dsh 界面以 webview 形式内嵌到侧边栏。', [toolBlock()]),
        ],
      }),
      title: '正常对话',
      expect: '会话面板列出会话；主区显示用户消息（右侧）+ 助手回复，含 markdown 加粗、一条折叠工具卡（Ran a command bash / npm test）、「复制/反馈/分叉」操作栏；底部 composer + 模型 pill + 会话统计。',
    },

    markdown: {
      state: base({
        messages: [
          u('把各环节分工整理成文档，表格排好看点。'),
          at('## 各环节分工总览\n\n| 环节 | 谁负责 | 能否自动化 |\n| --- | --- | --- |\n| 认领/写方案 | 人 + agent | 半自动 |\n| 开发 | agent | 自动 |\n| 自测（单测+编译） | agent | 自动 |\n| 人工 gate（隔离 VSCode 验收） | 人 | 不能 |\n| 合入+回归 | 主线 agent | 自动 + 人工抽查 |\n\n> 这是目前的协作分工，发布走 vsce publish。\n\n- 变更记录随状态流转更新\n- 不维护手工索引表\n\n[链接](https://example.com) 与行内 `code`。\n\n---\n\n- [x] 已完成项\n- [ ] 待办项'),
        ],
      }),
      title: 'markdown 富格式',
      expect: '助手消息：`<h2>` 分级标题「各环节分工总览」；三列表格（环节/谁负责/能否自动化）带网格线 + 表头底色、列宽随内容收窄左对齐、不溢出；引用块左栏线；圆点列表；主题色链接；hr 分隔线；任务清单保留 checkbox 且去圆点。',
    },

    'markdown-link-click': {
      state: base({
        messages: [
          u('把接口文档里的链接给我。'),
          at('参考 [示例站点](https://example.com)，反馈发 [邮箱](mailto:feedback@example.com)。'),
        ],
      }),
      interact: `(() => {
        const a = document.querySelector('.md a[href^="https://"]')
        a?.click()
      })()`,
      title: 'chat 链接点击：外部链接不导航',
      expect: '助手消息渲染出两个链接（https 示例站点 / mailto 邮箱，主题链接色）；点击 https 链接后页面**不导航**——截图仍是 chat 界面（该消息与 composer 原样保留），没有变成 example.com 的页面；webview 侧已拦下默认导航并 post openExternal（宿主用系统浏览器打开，走真实 dev-ui-test 验收）。',
    },

    'markdown-link-menu': {
      state: base({
        messages: [u('把接口文档里的链接给我。'), at('参考 [示例站点](https://example.com)。')],
      }),
      interact: `(() => {
        const a = document.querySelector('.md a[href^="https://"]')
        a?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 320, clientY: 220 }))
      })()`,
      title: 'chat 链接右键菜单：内置浏览器选项',
      expect: '右键点击 https 链接后弹出自绘菜单（popover，定位于鼠标附近）：两项「在系统浏览器中打开」「在 VS Code 内置浏览器中打开」（均带浏览图标）；页面不导航，chat 界面（消息/composer）原样保留。',
    },

    'session-mention': {
      // 用户气泡走纯文本渲染，mention 按 `@[label](dsh-session:...)` 切成 chip + 正文。
      state: base({
        messages: [u('@[DSH-ONE子代理嵌套支持情况](dsh-session:InNlc3MtMSI) 根据这个对话，分析一下嵌套子代理的依赖关系。')],
      }),
      theme: 'dark',
      title: '会话引用 chip 基线（暗色）',
      expect: '用户气泡（右侧）内：一个 @会话引用 chip（🔗 图标 + 链接色「DSH-ONE子代理嵌套支持情况」字重 500），chip 之后紧跟着正文「根据这个对话，分析一下嵌套子代理的依赖关系。」，两者在同一行；chip 内文字与同行正文文字基线对齐（不再相对抬高 2px）。chip 是行内 flex 无边框背景，链接色，hover 下划线（截图为静态不核对 hover）。',
    },

    'subagent-card-snapshot': {
      // fork 快照副本：会话自己的聊天流里有一条 subagent 调用卡（历史复制来的
      // 占位结果），但血缘树（state.subagents）不含该子代理 → 应加「快照副本」标注。
      state: base({
        messages: [
          u('让子代理调研一下会话 fork 行为。'),
          at('已派子代理去调研。', [subagentBlock('session-sub-1')]),
        ],
        subagents: [],
      }),
      title: '聊天流：subagent 调用卡（快照副本标注）',
      expect: '助手消息里有一条 subagent 工具调用卡（动作短语「Ran a subagent」+ 标题「子代理」）；卡下方出现一行醒目但克制的小字标注「快照副本：原子代理已不在本会话」（警示色，比普通 detail 略醒目，单行不撑开卡）；顶部无「N 个子代理」chip（state.subagents 为空，血缘树不含该子代理）。',
    },

    'subagent-card-live': {
      // 正常会话：同一条 subagent 调用卡，但血缘树含该子代理 → 不应加标注。
      state: base({
        messages: [
          u('让子代理调研一下会话 fork 行为。'),
          at('已派子代理去调研。', [subagentBlock('session-sub-1')]),
        ],
        subagents: [{ sessionId: 'session-sub-1', title: '调研会话 fork', running: false, updatedAt: 1_700_000_000_000 }],
      }),
      title: '聊天流：subagent 调用卡（血缘内，不标注）',
      expect: '同一条 subagent 工具调用卡（「Ran a subagent」+「子代理」），但**不出现**「快照副本：原子代理已不在本会话」标注（该子代理在本会话血缘树里）；顶部出现「1 个子代理」chip（血缘树含该子代理，点击可展开下拉）。',
    },

    empty: {
      // blankHero 要求 sessionId !== null（空白会话已附着）且无消息/待办/队列/jobs。
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: 'dsh-one', agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' }, statsLine: undefined }),
      title: '空会话 hero',
      expect: '空会话 hero（无历史）：品牌鱼标 + 标题「探索未至之境预览版」+ workspace chip（dsh-one）+ preset 选择 chip（标准模式/深度思考）+ 大圆角 composer 卡（canSend 就绪）。',
    },

    'dsh-not-found': {
      state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, serverError: 'dshNotFound', statsLine: undefined }),
      title: '找不到 dsh（安装引导）',
      expect: '主区居中显示「未检测到 dsh 安装」+ 说明文案 + 「查看安装指南」链接；无 composer；侧边栏会话列表正常。',
    },

    approval: {
      state: base({ pending: [{ kind: 'approval', rpcId: 'rpc-1', sessionId: 'sess-1', approvalId: 'appr-1', toolName: 'bash', reason: '允许执行 npm test 吗？' }] }),
      title: '权限批准（composer 接管面板）',
      expect: '输入区位置（composer 处）渲染接管面板，**不在消息流尾部**：面板 header「权限请求」+ 右上最小化按钮（chevron）；面板正文：工具名「bash」+ 原因「允许执行 npm test 吗？」+ 「允许一次/拒绝」两个按钮；消息流尾部**没有**旧的 pending 卡；普通 composer 输入框**不显示**（输入区被面板替换）。',
    },

    question: {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（composer 接管面板）',
      expect: '输入区位置渲染接管面板：header「等待你的回答」+ 最小化按钮（单题**无**分页器）；正文：问题「用哪种排序？」+ header「排序方向」+ 单项选择（最新优先/最旧优先）+ 「其他（自定义回答）」输入框 + 「提交」按钮（初始禁用——半透明不可点）；消息流尾部无 pending 卡，无普通 composer。',
    },

    'question-selected': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（已选一项，未提交）',
      interact: `document.querySelectorAll('.question-options .option-btn')[0]?.click()`,
      expect: '点击「最新优先」后：该选项高亮（selected outline，· 实心），**接管面板仍在**（没有提交——答案没有发走、对话没有继续）；「提交」按钮变为可用（不透明）。',
    },

    'question-multi': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-4', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }, { question: '要不要包含测试目录？', options: [{ label: '包含' }, { label: '不包含' }] }] }] }),
      title: '多题问答（分页器 1/2）',
      expect: '接管面板 header「等待你的回答」+ 分页器（‹ 1/2 ›，上一题 ‹ 禁用、下一题 › 可用）+ 最小化按钮；正文只有**第一题**（排序方向题），第二题不出现；「跳过本题」+「提交」两个按钮；提交禁用（未选任何答案——半透明不可点），跳过可点。',
    },

    'question-page2': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-4', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }, { question: '要不要包含测试目录？', options: [{ label: '包含' }, { label: '不包含' }] }] }] }),
      title: '多题问答（翻到第 2 题）',
      interact: `document.querySelector('.panel-pager .pager-btn:last-child')?.click()`,
      expect: '分页器显示 ‹ 2/2 ›（上一题 ‹ 可用、下一题 › 禁用）；正文只显示**第二题**「要不要包含测试目录？」；「跳过本题」不显示（最后一题没有下一题可跳）；「提交」按钮存在。',
    },

    'question-minimized': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '问答面板最小化（去聊天里说）',
      interact: `document.querySelector('.panel-toggle')?.click()`,
      expect: '面板只剩 header 一行（「等待你的回答」+ 展开按钮，chevron 朝上/翻转）+ 回答输入行：输入框（placeholder「在聊天里说…（Enter 提交为回答）」）+「提交」按钮；正文（题目/选项）隐藏；无普通 composer。',
    },

    'plan-review-chat': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-3', sessionId: 'sess-1', questions: [{ question: '批准这个方案吗？', detail: '### 方案\n把 sessionStore 改成 immutable，并拆分 reducer。', options: [{ label: '批准' }, { label: '拒绝' }], intent: { kind: 'plan-review', approve: '批准' } }] }] }),
      title: '计划评审（去聊天里说后）',
      interact: `[...document.querySelectorAll('.plan-actions button')].find((b) => b.textContent.includes('去聊天里说'))?.click()`,
      expect: '点击「去聊天里说」后：面板最小化（只剩 header「计划待审」+ 展开按钮）+ 回答输入行（「在聊天里说…」输入框 + 提交按钮）；warn strip/计划 Markdown/三分按钮全部隐藏。',
    },

    'plan-review': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-3', sessionId: 'sess-1', questions: [{ question: '批准这个方案吗？', detail: '### 方案\n把 sessionStore 改成 immutable，并拆分 reducer。', options: [{ label: '批准' }, { label: '拒绝' }], intent: { kind: 'plan-review', approve: '批准' } }] }] }),
      title: '计划评审（PlanReviewPanel 三分结构）',
      expect: '接管面板 header「计划待审」+ 最小化按钮；正文：**warn strip 警示条**（⚠ 图标 + 「计划待审」，黄色底/边框）+ 计划 Markdown 全文直接展开（### 方案 + 正文，限高滚动，**无**「查看详情」折叠） + 三分按钮行：「批准」（主按钮 option-btn 样式，bullet ·）+「拒绝」（次要按钮）+「去聊天里说」（次要按钮）；**不再有**「其他（自定义回答）」输入框与「确认」按钮（三分结构替代）；消息流尾部无 pending 卡。',
    },

    todos: {
      state: base({ todos: [{ content: '梳理架构', status: 'completed' }, { content: '写测试', status: 'in_progress' }, { content: '发版', status: 'pending' }] }),
      title: 'todo 清单卡',
      expect: 'composer 上方一条可折叠的「任务 N 已完成 · M 进行中 · K 待处理」摘要卡；内容含三个 todo 项及其状态。',
    },

    subagents: {
      state: base({ subagents: [{ sessionId: 'sub-1', title: '子代理 A', running: true, updatedAt: Date.now(), children: [{ sessionId: 'sub-1-1', title: '孙代理', running: false, updatedAt: Date.now() }] }] }),
      title: '子代理下拉',
      expect: '头部「N 个子代理」chip，点开下拉显示血缘树：子代理 A（运行态像素环）→ 孙代理（已完成灰点），层级缩进。',
    },

    history: {
      state: base({ hasEarlierHistory: true, loadingEarlier: false }),
      title: '有更早历史',
      expect: '消息列表顶部显示「加载更早」入口（有更多历史时）；点它触发 loadEarlier。',
    },

    'model-picker': {
      state: base(),
      modelCatalog: { current: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' }, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }], defaultEffort: 'high' }] }] },
      title: '模型选择器',
      expect: 'footer 模型 pill 可点开下拉：DeepSeek 组 → DeepSeek-V4-Flash → High/Low 档位，当前为 high。',
    },

    // 切换模型后 contextBar 立即反映新模型窗口（回归点：不等下一条消息）。
    // 从 1M 切到 256K 后、未发消息前，窗口应立刻是 256K 而不是旧 1M。
    'context-switch-smaller-window': {
      state: base({
        contextUsage: { percent: 96, usedTokens: 245_000, contextWindow: 256_000, turns: 3 },
      }),
      title: 'contextBar：切到更小窗口模型后立即重算',
      expect: '右下角 contextBar 立即显示新窗口：点击可见「上下文已用 96%（~245K / 256K）」，条形按剩余轮数分级变色（245K 已很接近 256K，应为危险/警示色而非绿色）；bar 不显示旧 1M 窗口。',
    },

    'context-switch-overflow': {
      state: base({
        contextUsage: { percent: 100, usedTokens: 260_000, contextWindow: 256_000, turns: undefined },
      }),
      interact: `document.querySelector('.context-bar')?.click()`,
      title: 'contextBar：切换后已用量超新窗口（overflow）',
      expect: '点击 contextBar 弹出面板：头部「上下文已用 100%（~260K / 256K）」；面板内出现一行红色提示「上下文已超出当前模型窗口：建议先切回之前的模型执行 /compact 压缩，再切换模型。」；bar 为红色（level-overflow），title 含「已超出当前模型窗口」。',
    },

    'context-switch-window-unknown': {
      state: base({
        // 切到「本进程从未观察过窗口」的模型（映射无记录）：明确占位，不沿用旧窗口。
        contextUsage: { windowUnknown: true, usedTokens: 245_000 },
      }),
      interact: `document.querySelector('.context-bar')?.click()`,
      title: 'contextBar：切换后窗口未知（占位）',
      expect: '右下角 contextBar 显示灰字占位「窗口未知」（而非旧 1M 窗口的占用比例）；悬停 title 为说明（该模型尚未产生上下文数据、发送下一条消息后显示）；点击占位弹出面板：头部「窗口用量未知」+「已用 ~245K」+ 说明行（中性灰，非红色错误）。',
    },

    // ================= 侧栏 sessions 面板（拆分后独立 webview） =================

    sessions: {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        s.workspaces[0].sessions = [
          sess('sess-1', 'DSH One 示例会话', '3 小时前', { running: true }),
          sess('sess-2', '重构 sessionStore', '5 小时前', { unread: true }),
          sess('sess-3', '置顶的调研会话', '昨天', { pinned: true }),
          sess('sess-4', '当前附加的会话', '10 分钟前'),
        ]
        s.workspaces[1].sessions = [
          sess('sess-5', 'dsh web 可展开 UI 调研', '9 小时前', { pendingInteraction: 'approval' }),
        ]
        s.workspaces[2].sessions = [sess('sess-6', '未分组里的孤儿会话', '2 小时前')]
        s.pinned = ['sess-3']
        s.unread = ['sess-2']
        s.attachedSessionId = 'sess-4'
        return s
      })(),
      title: '侧栏面板（综合列表）',
      expect: '头部工具栏（搜索框/排序/刷新/折叠全部/添加工作区）；dsh-one 组：vscode 标签、文件夹染蓝（组内有 active 行）、组名右侧角标（环 1 → 运行中 + 绿点 1 → 未读）、「sess-4 当前附加的会话」行高亮（active）；行首状态槽：sess-1 像素环、sess-2 未读绿点 + 标题加粗、sess-3 置顶图钉（槽位空时）；workspace 行尾 hover 动作仅结构存在（截图为静态，不核对 hover）；dsh-web research 组：sess-5 黄色待审批点（pendingInteraction）；未分组虚拟组显示「sess-6 未分组里的孤儿会话」。',
    },

    'sessions-search': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        s.query = '重构'
        s.collapsed = ['ws-main'] // 搜索态应强制展开，忽略折叠持久化
        s.workspaces[0].sessions = [
          sess('sess-2', '重构 sessionStore', '5 小时前'),
          sess('sess-4', '搜索词在内容里的大杂烩', '10 分钟前', { contentSnippet: '去重构了一下 sessionStore 的派生逻辑，顺手把派生状态集中到 reducer。' }),
        ]
        s.contentSearchHasMore = true
        return s
      })(),
      title: '侧栏面板（搜索：标题/内容命中 + 高亮）',
      // 输入框词由用户输入流驱动（sessionsSearchDraft 模块态），快照不回填；
      // 补一个输入模拟让前端态完整（draft + has-text → 清除 ✕ 可见）。
      interact: `(() => { const i = document.querySelector('.sessions-search'); i.value = '重构'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      expect: '搜索框内有关键词「重构」、右侧出现清除 ✕（search-clear）；「ws-main」组头展开（忽略 collapsed）：sess-2 行标题里「重构」加粗+变色（mark.dsh-mark）；sess-4 行下方 .session-snippet 浅色小字块，命中词「重构」同样 mark 高亮；底部「还有更多匹配会话，可尝试更精确的关键词」提示行。',
    },

    'sessions-search-degraded': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.query = 'session'
        s.contentSearchError = true
        return s
      })(),
      interact: `(() => { const i = document.querySelector('.sessions-search'); i.value = 'session'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      title: '侧栏面板（全文搜索降级提示）',
      expect: '搜索框有关键词「session」+ 清除 ✕；列表底部一条「全文搜索不可用，仅按标题匹配（dsh 搜索索引未启用）」提示行（sessions-search-degraded）；该行悬停有 data-tip 详情（截图为静态，核对行本体与样式）。',
    },

    'sessions-collapsed': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        s.collapsed = ['ws-main', 'ws-research', UNGROUPED]
        return s
      })(),
      title: '侧栏面板（全部折叠）',
      expect: '三个组头（dsh-one / dsh-web research / 未分组）都折叠：文件夹闭合图标 + 向右箭头 + 组名；组下不渲染任何会话行；头部「折叠所有工作区」按钮图标为 +（boxedPlus，表示点击展开全部）；组角标仍显示（折叠/展开一致）。',
    },

    'sessions-menu': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [sess('sess-3', '置顶的调研会话', '昨天', { pinned: true })]
        s.pinned = ['sess-3']
        return s
      })(),
      interact: `(() => { const row = document.querySelector('.session-row[data-session-id="sess-3"]'); row?.classList.add('menu-open'); row?.querySelector('.row-action')?.click() })()`,
      title: '侧栏面板（会话 ⋯ 菜单）',
      expect: '点击会话行尾 ⋯ 后弹出菜单，自上而下：重命名 / 置顶（带 ✓ 选中态）/ 标为未读 / 分叉会话 / 复制引用 / 归档会话；「复制会话 ID」不在菜单里；置顶会话的菜单项「置顶」带 checked；全部项可用（无 disabled 灰置）。',
    },

    'sessions-menu-busy': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [sess('sess-1', 'DSH One 示例会话', '3 小时前', { running: true })]
        return s
      })(),
      interact: `(() => {
        const row = document.querySelector('.session-row[data-session-id="sess-1"]')
        row?.classList.add('menu-open')
        const btn = row?.querySelector('.row-action')
        btn?.click()
        setTimeout(() => {
          const items = document.querySelectorAll('.menu-item.disabled')
          const last = items[items.length - 1] // 「归档会话」禁用项
          if (last) last.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        }, 150)
      })()`,
      title: '侧栏面板（运行中会话菜单：禁用 + 悬停提示）',
      expect: '运行中会话（行首像素环）的 ⋯ 菜单：重命名/置顶/分叉/复制引用正常；「标为已读/未读」与「归档会话」灰置（.menu-item.disabled）；悬停「归档会话」项时其下方出现 tooltip 气泡「运行中的会话不能归档」；无「复制会话 ID」。',
    },

    'sessions-menu-unread': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-2')
        s.workspaces[0].sessions = [sess('sess-2', '重构 sessionStore', '5 小时前', { unread: true })]
        s.unread = ['sess-2']
        return s
      })(),
      interact: `(() => { const row = document.querySelector('.session-row[data-session-id="sess-2"]'); row?.classList.add('menu-open'); row?.querySelector('.row-action')?.click() })()`,
      title: '侧栏面板（未读会话菜单：归档禁用）',
      expect: '未读（非运行）会话的 ⋯ 菜单：「标为已读」可用（选中态 ✓）；「归档会话」灰置，悬停提示「未读的会话不能归档」（截图核对项本体与灰置样式）；其余项正常；无「复制会话 ID」。',
    },

    'sessions-menu-fork-disabled': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-9')
        s.workspaces[0].sessions = [sess('sess-9', '从未完成的会话', '10 分钟前', { hasCompletedTurn: false })]
        return s
      })(),
      interact: `(() => {
        const row = document.querySelector('.session-row[data-session-id="sess-9"]')
        row?.classList.add('menu-open')
        row?.querySelector('.row-action')?.click()
        setTimeout(() => {
          const items = [...document.querySelectorAll('.menu-item')]
          const fork = items.find((i) => i.textContent?.includes('分叉会话'))
          if (fork) fork.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        }, 150)
      })()`,
      title: '侧栏面板（从未完成轮次的会话：分叉禁用 + 悬停提示）',
      expect: '从未完成过轮次的会话（hasCompletedTurn=false）的 ⋯ 菜单：「分叉会话」灰置（.menu-item.disabled，置灰不响应点击）；悬停该项时其下方出现 tooltip 气泡「会话没有已完成轮次，无法分叉」；「重命名/置顶/标为未读/复制引用」正常；「归档会话」正常（非运行/未读/无待处理）；无「复制会话 ID」。',
    },

    'sessions-rename': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        s.workspaces[0].sessions = [sess('sess-4', '当前附加的会话', '10 分钟前')]
        s.attachedSessionId = 'sess-4' // editor 面板开着且附着 → 单击行内重命名
        return s
      })(),
      interact: `document.querySelector('.session-row[data-session-id="sess-4"]')?.click() // 已打开会话单击 → 行内重命名`,
      title: '侧栏面板（行内重命名编辑态）',
      expect: '点击已附加（active 高亮 + attachedSessionId）的会话行后，该行标题位置变为输入框（.rename-input，prefill 原标题、全选）；行内其他元素（状态槽/时间/⋯）仍在；未附加会话单击是打开会话（见 sessions-active-pending）。',
    },

    'sessions-active-pending': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        s.workspaces[0].sessions = [sess('sess-4', '当前附加的会话', '10 分钟前')]
        s.attachedSessionId = null // 仅高亮（懒加载待附着）：面板没开 → 单击打开会话
        return s
      })(),
      interact: `document.querySelector('.session-row[data-session-id="sess-4"]')?.click() // 未附着（仅高亮）→ 打开会话，不进重命名`,
      title: '侧栏面板（仅高亮未附着：点击打开）',
      expect: '会话行高亮（active）但 attachedSessionId 为 null（reload 后面板未开、懒加载待附着的典型态）；点击行后**不出现** rename-input——行保持标题文本；行为是 post sessionOpen 而非重命名。',
    },

    // ================= workflow 运行卡（run→phase→member 三层折叠行） =================

    // 运行中卡：默认展开（facts.mode=running），interact 点 run header 折叠。
    // 回归点：点击 header 要**立即**折叠（不等下一个 snapshot），见
    // ---- JSON 输出树（tool 输出为 JSON 对象/数组时渲染 JsonTree） ----
    // 一条返回嵌套 JSON 的工具调用：工具卡展开后 OUT 走 JsonTree（根展开、
    // 嵌套容器收起显示 {…}、原始值按类型着色、箭头可点）。
    'json-output': {
      state: base({
        messages: [
          u('查一下这几个服务的健康状态。'),
          at('开始健康检查。', [
            toolBlock({
              name: 'bash', title: 'bash', detail: 'curl /health',
              output: JSON.stringify({
                status: 'ok',
                checks: {
                  gateway: { healthy: true, latency_ms: 12 },
                  auth: { healthy: true, latency_ms: 31 },
                  billing: { healthy: false, latency_ms: 88, error: 'timeout' },
                },
                degraded: false,
                retries: 0,
                debug: null,
              }, null, 2),
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: '工具输出 JSON 树（默认态：根展开/嵌套收起 + 复制按钮）',
      interact: `document.querySelector('.tool-disclosure summary')?.click()`,
      expect: '工具卡（Ran a command bash / curl /health）点击摘要后展开，OUT 卡片内显示 JsonTree：等宽字体、深色 code 块背景；树右上角一条小「复制」按钮（克制样式，复制整树 pretty JSON，无语言标签）；树按节点缩进；根 `{` 展开，其直接子 key `checks` 是折叠容器（右侧箭头 + `{…}` 预览），其余子 key 为原始值——`status: "ok"`（玫红 string）、`degraded: false`（蓝 keyword）、`retries: 0`（蓝 number）、`debug: null`（蓝 keyword）；key（property）为蓝、`:` 与括号标点为灰白；根 `}` 在独立行对齐；不出现平铺的一大段 JSON 文本。“IN”仍为纯文本 JSON。',
    },

    // 点树右上角「复制」按钮：复制整树的 2 空格 pretty JSON（copyPrettyJson）。
    // harness 里剪贴板权限不稳定（需真实手势/secure 上下文），interact 先 monkeypatch
    // navigator.clipboard.writeText 把内容存到 window.__copied，点击后 evaluate 断言。
    'json-output-copy': {
      state: base({
        messages: [
          u('查一下这几个服务的健康状态。'),
          at('开始健康检查。', [
            toolBlock({
              name: 'bash', title: 'bash', detail: 'curl /health',
              output: JSON.stringify({
                status: 'ok',
                checks: { gateway: { healthy: true } },
                retries: 0,
                debug: null,
              }, null, 2),
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: '工具输出 JSON 树（点复制按钮）',
      interact: `(() => {
        window.__copied = null
        try { navigator.clipboard.writeText = async (t) => { window.__copied = t } } catch (e) {}
        document.querySelector('.tool-disclosure summary')?.click()
        setTimeout(() => document.querySelector('.json-tree-copy')?.click(), 20)
      })()`,
      expect: '树上/右上角「复制」按钮可点击；点击后把整棵树的 2 空格 pretty JSON 写入剪贴板（interact 里 monkeypatch 的 __copied 应等于整树 pretty JSON，即 `{\n  "status": "ok",\n  "checks": {\n    "gateway": {\n      "healthy": true\n    }\n  },\n  "retries": 0,\n  "debug": null\n}`）。视觉上按钮仍在、与 json-output 默认态一致；按钮文案成功时应短暂变「已复制」（截图静态，不核对文案变化）。',
    },

    // 节点级复制：每行（非根、含容器/原始值行）行尾 hover 出现小复制图标，点击复制该
    // 节点的 pretty JSON。interact 把两次点击的复制内容 append 到 __copiedList 再断言
    // 首个（checks 容器）与第二个（status 原始值）分别等于各自节点的 pretty JSON。
    'json-output-node-copy': {
      state: base({
        messages: [
          u('查一下这几个服务的健康状态。'),
          at('开始健康检查。', [
            toolBlock({
              name: 'bash', title: 'bash', detail: 'curl /health',
              output: JSON.stringify({
                status: 'ok',
                checks: { gateway: { healthy: true } },
                retries: 0,
                debug: null,
              }, null, 2),
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: '工具输出 JSON 树（节点级复制）',
      interact: `(() => {
        window.__copiedList = []
        try { navigator.clipboard.writeText = async (t) => { window.__copiedList.push(t) } } catch (e) {}
        document.querySelector('.tool-disclosure summary')?.click()
        setTimeout(() => {
          document.querySelector('.json-tree-row[data-path="$.checks"] .json-tree-copy-icon')?.click()
          document.querySelector('.json-tree-row[data-path="$.status"] .json-tree-copy-icon')?.click()
        }, 20)
      })()`,
      expect: '每行（checks 容器行、status 原始值行等）行尾在 hover 时出现小复制图标（默认隐藏，深度低）；点击 checks 行的图标复制到的是 checks 容器自己的 pretty JSON（`{\n  "gateway": {\n    "healthy": true\n  }\n}`），点击 status 行图标复制到的是 `"ok"`（原始值）——interact 里 __copiedList 依次应为这两个值。整树右上角「复制」按钮仍保留。行级图标成功时短暂换勾（截图静态见图标本身，不核对成功态）。',
    },

    // 同上 JSON 树，但额外点开 `checks` 容器：验证箭头展开交互——嵌套节点展开
    // 出子 key（gateway/auth/billing），箭头从右指转向下指。
    'json-output-expand': {
      state: base({
        messages: [
          u('查一下这几个服务的健康状态。'),
          at('开始健康检查。', [
            toolBlock({
              name: 'bash', title: 'bash', detail: 'curl /health',
              output: JSON.stringify({
                status: 'ok',
                checks: {
                  gateway: { healthy: true, latency_ms: 12 },
                  auth: { healthy: true, latency_ms: 31 },
                  billing: { healthy: false, latency_ms: 88, error: 'timeout' },
                },
                degraded: false,
                retries: 0,
                debug: null,
              }, null, 2),
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: '工具输出 JSON 树（点箭头展开 checks）',
      // 先点摘要展开工具卡，等 `<details>` 的 toggle 事件（异步）把展开态写入
      // detailsOpen 后再点 checks 箭头（箭头点击触发重建，读的就是已持久化的态，
      // 不会把刚展开的卡片又收回）。同步连点会在 toggle 派发前重建、卡片被重置。
      interact: `(() => {
        document.querySelector('.tool-disclosure summary')?.click()
        setTimeout(() => {
          const arrow = document.querySelector('.json-tree-row[data-path="$.checks"] .json-tree-arrow')
          arrow?.click()
        }, 20)
      })()`,
      expect: '点击 `checks` 容器的箭头后它展开：箭头从右指转向下指，`checks` 下缩进出现子 key `gateway` / `auth` / `billing`（每个再是折叠容器 `{…}`）；`checks` 行从 `checks: {…}` 变为 `checks: {` 并在其下出现闭合 `}` 行；其余原始值行（status/degraded/retries/debug）与根结构保持（各自缩进层级正确，vscode-dark 主题）。初始渲染时 `checks` 收起、`gateway` 等子 key 不与它并列——这在默认态截图核对。',
    },

    // ---- 消息正文里的 JSON 也接入 JsonTree ----
    // 助手正文恰为整段 JSON 对象字面量（无 ```json 围栏）：当前应渲染成树（而非走
    // markdown 的 <p> 纯文本）。
    'json-message-bare': {
      state: base({
        messages: [
          u('把服务健康状况整理成 JSON 给我。'),
          at(JSON.stringify({
            status: 'ok',
            checks: {
              gateway: { healthy: true, latency_ms: 12 },
              auth: { healthy: true, latency_ms: 31 },
            },
            degraded: false,
            retries: 0,
          }, null, 2)),
        ],
      }),
      theme: 'dark',
      title: '消息正文 JSON（裸对象字面量 → 树）',
      expect: '助手消息直接把整段 JSON 渲染成 JsonTree（无 markdown 语法残留、无 `<p>` 纯文本、无 code block 折叠「其余 N 行」）：根 `{` 展开、`checks` 容器折叠 `{…}`、`status`/`degraded`/`retries` 原始值按类型着色（string 玫红/true·false 蓝 keyword/0 蓝 number）；树右上角整树「复制」按钮；每行行尾 hover 出现节点复制图标。',
    },

    // 助手正文里有一个 ```json 围栏代码块：该块应渲染成树，围栏外的普通文本保持
    // markdown。
    'json-message-fenced': {
      state: base({
        messages: [
          u('给我一个健康检查结果。'),
          at('检查结果如下：\n\n```json\n{\n  "status": "ok",\n  "checks": {\n    "gateway": { "healthy": true }\n  },\n  "retries": 0\n}\n```\n\n需要的话我可以再跑一次。'),
        ],
      }),
      theme: 'dark',
      title: '消息正文 JSON（```json 围栏块 → 树）',
      expect: '助手消息里有围栏外的普通文本（「检查结果如下：」与「需要的话我可以再跑一次。」，走 markdown），中间插入的 ```json 代码块渲染成 JsonTree：根 `{` 展开、`checks` 折叠 `{…}`、`status`/`retries` 原始值着色；树右上角整树「复制」按钮；不再显示 code block 的「… 共 N 行，点击展开」折叠（树用节点展开/收起控制空间）。',
    },

    // ---- 超大 JSON：超过行数阈值（>300 行 pretty）回退 code block 折叠 ----
    // 生成 rows: [{n,v}...]：M 个对象 → 4*M+5 行，M=75 → 305 行，超过阈值 → 应回退成
    // code block（含头部条「json」语言标签 + 复制按钮 + 「… 其余 N 行」折叠）。
    'json-message-over': {
      state: base({
        messages: [
          u('给我一份大的健康检查数据。'),
          at('批量结果：\n\n```json\n' + JSON.stringify({
            total: 75,
            rows: Array.from({ length: 75 }, (_, i) => ({ n: i, v: `row-${i}` })),
          }, null, 2) + '\n```\n\n以上。'),
        ],
      }),
      theme: 'dark',
      title: '消息正文 JSON（超阈值 → code block 折叠）',
      expect: '助手消息里的 ```json 代码块**不渲染成树**，而是回退到 code block：头部条有语言标签「json」+「复制」按钮（code block 复制），正文折叠成「头部行 + … 其余 N 行 + 尾部行」，点「展开其余 N 行」可展开全部（对齐 codeBlockPreview 的 16 行阈值）；树形态（右箭头缩进/节点展开/整树复制按钮）**不出现**。围栏外的普通文本（「批量结果：」「以上。」）走 markdown。',
    },

    // 略低于阈值：M=73 → 4*73+5=297 行，<=300 → 仍渲染成树。
    'json-message-under': {
      state: base({
        messages: [
          u('给我一份小的健康检查数据。'),
          at('结果：\n\n```json\n' + JSON.stringify({
            total: 73,
            rows: Array.from({ length: 73 }, (_, i) => ({ n: i, v: `row-${i}` })),
          }, null, 2) + '\n```'),
        ],
      }),
      theme: 'dark',
      title: '消息正文 JSON（低于阈值 → 仍树）',
      expect: '助手消息里的 ```json 代码块（297 行 pretty，低于阈值）仍渲染成 JsonTree：根 `{` 展开、`rows` 折叠 `[…]`、`total` 原始值着色、树右上角整树「复制」按钮；不出现 code block 的「… 共 N 行」折叠。',
    },

    // workflow-run-card-cannot-collapse 条目（click 触达 render()）。
    'workflow-running': {
      state: base({
        messages: [u('检查一下微服务集群的健康状态。'), at('开始对微服务集群做健康检查。')],
        workflowRuns: [
          {
            runId: 'run-1',
            name: 'demo-microservices-check-2',
            status: 'running',
            anchorSeq: 1,
            phases: [
              {
                key: 'value:4:检查服务',
                phase: '检查服务',
                members: [
                  { seq: 0, label: '订单服务 健康检查', childId: 'c-0', status: 'running' },
                  { seq: 1, label: '结算服务 依赖探测', childId: 'c-1', status: 'completed' },
                  { seq: 2, label: '网关服务 存活探测', childId: 'c-2', status: 'running' },
                ],
              },
            ],
          },
        ],
      }),
      title: 'workflow 运行卡（点 run header 折叠）',
      interact: `document.querySelector('.workflow-run-header')?.click()`,
      expect: '点击 run 折叠行 header 后**立即**收起：chevron 转成 collapsed（-90°），header 尾部出现「3 个成员 · 运行中」分隔点摘要，phase 列表（检查服务 + 3 个成员行）不再渲染；run 卡片保留标题行。',
    },

    // 终止/异常卡（run 已 end 但含失败成员 → abnormal → 默认展开）：同样应能折叠。
    // 待确认项：终态卡是否也受影响（此处验证终态卡点击后也应立即折叠）。
    'workflow-finished': {
      state: base({
        messages: [u('部署脚本跑完了吗？'), at('部署脚本已收尾。')],
        workflowRuns: [
          {
            runId: 'run-2',
            name: 'deploy-blue-green',
            status: 'failed',
            anchorSeq: 1,
            phases: [
              {
                key: 'value:4:部署',
                phase: '部署',
                members: [
                  { seq: 0, label: '构建镜像', childId: 'd-0', status: 'completed' },
                  { seq: 1, label: '滚动更新', childId: 'd-1', status: 'failed' },
                ],
              },
            ],
          },
        ],
      }),
      title: 'workflow 终态卡（点 run header 折叠）',
      interact: `document.querySelector('.workflow-run-header')?.click()`,
      expect: '终态（failed，含失败成员 → abnormal 默认展开）run 卡点击 header 后**立即**收起：chevron collapsed、尾部「2 个成员 · 失败」，members 列表不再渲染；run 卡片保留标题行。',
    },

    // ---- 工具 diff 卡（左右分栏：左 old 右 new，LCS 行对齐 + 前 8 行对折叠） ----
    // 示例 diff 含全部四种行对：modify（修改，左右同排红/绿）、equal（相同行不着色）、
    // add（纯新增，右栏绿 + 左栏灰空位）、del（纯删除，左栏红 + 右栏灰空位）。
    // 13 行对 > 8：默认折叠到前 8 行对 + 「展开其余 5 行差异」。
    'diff-side-by-side': {
      state: base({
        messages: [
          u('把接口超时改成可配置的。'),
          at('改好了，改动如下：', [
            toolBlock({
              name: 'edit', title: 'Edited src/client.ts', detail: 'src/client.ts',
              diff: {
                oldText: [
                  'const TIMEOUT_MS = 30000',
                  '',
                  'export async function fetchClient(url: string) {',
                  '  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })',
                  '  if (!res.ok) throw new Error(`HTTP ${res.status}`)',
                  '  return res.json()',
                  '}',
                  '',
                  '// 旧配置直接硬编码',
                  'const retries = 2',
                  'const backoff = 500',
                  'const maxRetries = 5',
                ].join('\n'),
                newText: [
                  'const DEFAULT_TIMEOUT_MS = 30000',
                  '',
                  'export async function fetchClient(url: string, opts: { timeoutMs?: number } = {}) {',
                  '  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS',
                  '  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })',
                  '  if (!res.ok) throw new Error(`HTTP ${res.status}`)',
                  '  return res.json()',
                  '}',
                  '',
                  '// 新配置从环境变量读取',
                  'const retries = Number(process.env.HTTP_RETRIES ?? 2)',
                  'const maxRetries = 5',
                ].join('\n'),
              },
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: 'diff 卡左右分栏（折叠态）',
      expect: '工具卡动作行（edit / Edited src/client.ts / src/client.ts）下方是左右分栏 diff：外框一圈细边框，两列等宽网格，左栏老文本、右栏新文本；第 1 行对是修改行（左红底右绿底、文字在同一水平线），第 2 行对是相同空行（两栏都不着色）；分栏间有竖向分隔线；只显示前 8 行对，末尾「… 展开其余 5 行差异」提示；diff 卡与工具卡动作行之间有小间距。',
    },

    // 展开态：点击「展开其余」后显示全部 13 行对：修改行左右同排红/绿、纯新增行右绿
    // 左灰、纯删除行左红右灰、相同行不着色；行对齐逐行成立。
    'diff-side-by-side-open': {
      state: base({
        messages: [
          u('把接口超时改成可配置的。'),
          at('改好了，改动如下：', [
            toolBlock({
              name: 'edit', title: 'Edited src/client.ts', detail: 'src/client.ts',
              diff: {
                oldText: [
                  'const TIMEOUT_MS = 30000',
                  '',
                  'export async function fetchClient(url: string) {',
                  '  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })',
                  '  if (!res.ok) throw new Error(`HTTP ${res.status}`)',
                  '  return res.json()',
                  '}',
                  '',
                  '// 旧配置直接硬编码',
                  'const retries = 2',
                  'const backoff = 500',
                  'const maxRetries = 5',
                ].join('\n'),
                newText: [
                  'const DEFAULT_TIMEOUT_MS = 30000',
                  '',
                  'export async function fetchClient(url: string, opts: { timeoutMs?: number } = {}) {',
                  '  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS',
                  '  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })',
                  '  if (!res.ok) throw new Error(`HTTP ${res.status}`)',
                  '  return res.json()',
                  '}',
                  '',
                  '// 新配置从环境变量读取',
                  'const retries = Number(process.env.HTTP_RETRIES ?? 2)',
                  'const maxRetries = 5',
                ].join('\n'),
              },
            }),
          ]),
        ],
      }),
      theme: 'dark',
      title: 'diff 卡左右分栏（展开态，点击「展开其余」）',
      interact: `document.querySelector('.diff-toggle')?.click()`,
      expect: '点击「… 展开其余 5 行差异」后显示全部 13 行对：修改行左右同排（左红右绿，如 `const TIMEOUT_MS` 行对、`export async function fetchClient` 行对）；`  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })` 那行是纯新增（右栏绿、左栏灰空位）；`const backoff = 500` 是纯删除（左栏红、右栏灰空位）；`const retries = 2` 与 `const retries = Number(process.env.HTTP_RETRIES ?? 2)` 同排红/绿、末尾 `const maxRetries = 5` 两栏相同不着色；左右栏逐行水平对齐；toggle 文案变成「收起差异」。',
    },
  }

  catalog.conversation.sessions = window.sessionsTree('sess-1')

  // 基线冒烟集：主线合入后跑这批稳定场景做回归（ui-visual.sh --mode baseline）。
  // 新增功能的场景先加进 window.SCENARIOS 做 worktree 验收；要让它成为"以后谁都不能弄坏"
  // 的存量状态，就把它的名字加进 BASELINE_SCENARIOS —— 随合入并入主线基线。
  window.SCENARIOS = catalog
  window.BASELINE_SCENARIOS = [
    'conversation', 'markdown', 'empty', 'dsh-not-found', 'approval', 'question',
    'plan-review', 'todos', 'subagents', 'history', 'model-picker', 'sessions',
    'sessions-search', 'sessions-collapsed',
    'session-mention', 'workflow-running', 'workflow-finished', 'diff-side-by-side',
  ]
  window.DEFAULT_SCENARIO = 'conversation'
})()
