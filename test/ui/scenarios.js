// Chat webview 场景目录。每个场景定义一个 UI 渲染输入（state / sessions / modelCatalog），
// harness.html 按 ?scenario=<name> 选取并推给 webview，得到对应的界面状态。
// 用途：视觉回归 / UI 改动验证 —— 各种状态（含边角、错误态）都能确定性渲染、截图。
// 只增不改字段名；新增场景往 window.SCENARIOS 里加一个条目即可。
(function () {
  const UNGROUPED = '__ungrouped__'
  const rid = (p) => p + Math.random().toString(36).slice(2, 7)

  // ---- 消息/区块构造器 ----
  const u = (text) => ({ kind: 'user', id: rid('u'), text })
  const at = (text, extra) => ({ kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, blocks: [{ type: 'text', text }, ...(extra || [])] })
  const toolBlock = (over) => ({ type: 'tool', callId: rid('t'), name: 'bash', status: 'done', title: 'bash', detail: 'npm test', output: '7 passed, 0 failed', ...over })

  // ---- 默认会话树（侧边栏）快照 ----
  window.sessionsTree = function (activeId) {
    return {
      query: null,
      sortOrder: 'updatedDesc',
      serverState: 'running',
      dshNotFound: false,
      pinned: [],
      collapsed: [],
      unread: ['sess-2'],
      workspaces: [
        {
          workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', label: 'dsh-one', isCurrent: true,
          sessions: [
            { sessionId: 'sess-1', label: 'DSH One 示例会话', description: '3 小时前', running: false, pinned: false, unread: false, descendantRunning: false },
            { sessionId: 'sess-2', label: '重构 sessionStore', description: '5 小时前', running: false, pinned: false, unread: true, descendantRunning: false },
          ],
        },
        {
          workspaceId: 'ws-research', path: '/Users/cgeng/Workspaces/dsh-web', label: 'dsh-web research', isCurrent: false,
          sessions: [
            { sessionId: 'sess-3', label: 'dsh web 可展开 UI 调研', description: '昨天', running: false, pinned: false, unread: false, descendantRunning: false },
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

  // 每个场景 = { state, title, expect }：
  //   state  — ChatState/SessionsSnapshot（渲染输入，见 harness.html）
  //   title  — 显示名（给 agent / 人看）
  //   expect — 该状态应该呈现的逻辑与排版（agent 读截图后逐条对照核对，非像素 diff）
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
      title: '权限批准',
      expect: '底部 pending 卡「权限请求：bash / 允许执行 npm test 吗？」+ 「允许一次/拒绝」两个按钮；历史消息保留。',
    },

    question: {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问',
      expect: '底部 pending 卡显示问题「用哪种排序？」+ header + 单项选择（最新优先/最旧优先）+ 「其他（自定义回答，Enter 提交）」输入框。',
    },

    'plan-review': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-3', sessionId: 'sess-1', questions: [{ question: '批准这个方案吗？', detail: '### 方案\n把 sessionStore 改成 immutable，并拆分 reducer。', options: [{ label: '批准' }, { label: '拒绝' }], intent: { kind: 'plan-review', approve: '批准' } }] }] }),
      title: '计划评审',
      expect: '底部 pending 卡「批准这个方案吗？」+「▶ 查看详情」可展开 detail；两个 bullet 选项（批准/拒绝，无主次之分——CSS 只有 hover/选中做 outline）+「其他（自定义回答，Enter 提交）」输入框。',
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

    sessions: {
      // 附着 sess-2（state.sessionId 决定高亮/文件夹染蓝）+ sess-1 未读（SessionNodeModel.unread）。
      // 注：搜索过滤是宿主端 buildSessionTree 预过滤后才喂给 webview 的，静态 snapshot 需自己预过滤才可见；此处聚焦可观测的附着+未读。
      state: base({ sessionId: 'sess-2', sessionTitle: '重构 sessionStore', presetLabel: '深度思考', messages: [u('把 store 改成 immutable 吧。'), at('可以。把派生状态集中到 reducer，避免多处直接改 store。', [toolBlock({ detail: 'src/pure/sessionTree.ts' })])] }),
      sessions: (() => { const s = window.sessionsTree('sess-2'); s.workspaces[0].sessions[0].unread = true; s.workspaces[0].sessions[1].unread = false; return s })(),
      title: '侧边栏（附着 + 未读）',
      expect: '附着 sess-2：dsh-one 文件夹染蓝 + 「重构 sessionStore」行高亮；「DSH One 示例会话」带未读圆点（session-title unread）；dsh-web research 分组正常列出。',
    },
  }

  catalog.conversation.sessions = window.sessionsTree('sess-1')

  // 基线冒烟集：主线合入后跑这批稳定场景做回归（ui-visual.sh --mode baseline）。
  // 新增功能的场景先加进 window.SCENARIOS 做 worktree 验收；要让它成为"以后谁都不能弄坏"
  // 的存量状态，就把它的名字加进 BASELINE_SCENARIOS —— 随合入并入主线基线。
  window.SCENARIOS = catalog
  window.BASELINE_SCENARIOS = [
    'conversation', 'empty', 'dsh-not-found', 'approval', 'question',
    'plan-review', 'todos', 'subagents', 'history', 'model-picker', 'sessions',
  ]
  window.DEFAULT_SCENARIO = 'conversation'
})()
