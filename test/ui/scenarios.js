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

  // ---- 侧栏会话树快照构造器 ----
  const sess = (sessionId, label, description, over) => ({
    sessionId, label, description, running: false, pinned: false, unread: false, descendantRunning: false, ...over,
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
  ]
  window.DEFAULT_SCENARIO = 'conversation'
})()
