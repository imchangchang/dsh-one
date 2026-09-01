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

  const catalog = {
    // 正常对话
    conversation: { state: base() },

    // 空会话 hero：选 preset + workspace chip（sessionId 为 null）
    empty: { state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, workspaceLabel: 'dsh-one', agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' } }) },

    // 服务起不来（找不到 dsh）→ 安装引导
    'dsh-not-found': { state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, serverError: 'dshNotFound', statsLine: undefined }) },

    // 权限批准（approval）
    approval: { state: base({ pending: [{ kind: 'approval', rpcId: 'rpc-1', sessionId: 'sess-1', approvalId: 'appr-1', toolName: 'bash', reason: '允许执行 npm test 吗？' }] }) },

    // 工具提问（question）
    question: { state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }) },

    // 计划评审（plan-review）：单问 + detail + 选项≤2 + 其中一个命中 intent.approve
    'plan-review': { state: base({ pending: [{ kind: 'question', rpcId: 'rpc-3', sessionId: 'sess-1', questions: [{ question: '批准这个方案吗？', detail: '### 方案\n把 sessionStore 改成 immutable，并拆分 reducer。', options: [{ label: '批准' }, { label: '拒绝' }], intent: { kind: 'plan-review', approve: '批准' } }] }] }) },

    // todo 清单卡
    todos: { state: base({ todos: [{ content: '梳理架构', status: 'completed' }, { content: '写测试', status: 'in_progress' }, { content: '发版', status: 'pending' }] }) },

    // 子代理下拉
    subagents: { state: base({ subagents: [{ sessionId: 'sub-1', title: '子代理 A', running: true, updatedAt: Date.now(), children: [{ sessionId: 'sub-1-1', title: '孙代理', running: false, updatedAt: Date.now() }] }] }) },

    // 有更早的历史 → 「加载更早」
    history: { state: base({ hasEarlierHistory: true, loadingEarlier: false }) },

    // 模型选择器（点 footer 模型 pill 弹出）
    'model-picker': { state: base(), modelCatalog: { current: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' }, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }], defaultEffort: 'high' }] }] } },

    // 侧边栏：附着另一个会话 + 搜索词
    sessions: { state: base(), sessions: (() => { const s = window.sessionsTree('sess-2'); s.query = '重构'; s.sortOrder = 'title'; return s })() },
  }

  catalog.conversation.sessions = window.sessionsTree('sess-1')

  window.SCENARIOS = catalog
  window.DEFAULT_SCENARIO = 'conversation'
})()
