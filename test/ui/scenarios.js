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
  // 96×96 红色实心 PNG 的 base64：附件场景的图片内容，缩略图应显示红色方块。
  const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QMQ0AMAzAsEEqfzSDMgZ7m8NSAEQ+d0afzvpBPECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQIEDhAAECBAhQOECAAAECFA4QIECAAIUDBAgQoM0eFsgCpKYbmmoAAAAASUVORK5CYII='

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
    const workspaces = [
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
    ]
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
      baselineReady: true,
      recycleBin: [],
      recycleWorkspaces: [],
      recycleCollapsed: [],
      // 工作区分组状态（空 = 无分组、全部工作区）；分组场景按需覆写。
      groups: [],
      activeGroupId: null,
      groupMembership: {},
      workspaceDirectory: workspaces
        .filter((w) => w.workspaceId !== UNGROUPED)
        .map((w) => ({ workspaceId: w.workspaceId, label: w.label })),
      workspaces,
    }
  }

  // 工作区分组场景的分组数据（演示 = ws-main + ws-research；开发 = ws-main；日常 = 空组）。
  window.SESSION_GROUPS_FIXTURE = {
    groups: [
      { id: 'g-demo', name: '演示', count: 2 },
      { id: 'g-dev', name: '开发', count: 1 },
      { id: 'g-daily', name: '日常', count: 0 },
    ],
    groupMembership: { 'ws-main': ['g-demo', 'g-dev'], 'ws-research': ['g-demo'] },
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
    statsLine: '2 轮 · 16 步 | LLM 48.3秒 · 工具调用 26.9秒 | 首 token 平均 0.8秒 · 33 tok/s | 缓存命中 99% | 输入 33M tok · 输出 99.3K tok',
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

    'chat-stats-line': {
      // 会话统计行：官方 StatsLine 全字段（counts/durations/speeds/缓存命中/token 组，
      // 组间「 | 」分隔）由宿主格式化成字符串渲染，webview 原样逐字显示；文本超宽
      // 时省略号截断（input-stats CSS：11px、opacity .65、ellipsis），不换行不撑破。
      state: base({
        statsLine:
          '4 轮 · 197 步 | LLM 16分38秒 · 工具调用 3分48秒 | 首 token 平均 1秒 · 124 tok/s | 缓存命中 99% | 输入 33M tok · 输出 99.3K tok',
      }),
      title: '会话统计行：官方全字段（轮数/步数/LLM/工具/首 token/tok/s/缓存命中/输入输出）',
      expect:
        '输入框下方一行统计：左侧小字号灰字（11px/半透明）逐字显示「4 轮 · 197 步 | LLM 16分38秒 · 工具调用 3分48秒 | 首 token 平均 1秒 · 124 tok/s | 缓存命中 99% | 输入 33M tok · 输出 99.3K tok」，组与组以「 | 」分隔、组内以「 · 」分隔，字段与官方 StatsLine 对齐；右侧同一行是 context 占用环；文本超出面板宽度时省略号截断（单行不换行）。',
    },

    'chat-stats-line-empty': {
      // 投影缺失/无已闭步骤时 statsLine 为 undefined：统计行不渲染（context 环
      // 也未就绪时整行隐藏——0.1.1 服务器无 sessionStats 投影即此路径）。
      state: base({ statsLine: undefined }),
      title: '会话统计行缺省：无投影时整行不显示',
      expect:
        '输入框下方没有统计行（composer 底部只有权限/模型等 pill 行）；context 占用环同样不出现（contextUsage 未就绪）。',
    },

    'file-ref-bubble': {
      // @ 文件引用渲染：file 引用从气泡行内提升到附件区（图片缩略图懒加载，
      // 其他文件图标 chip），folder 引用保持行内 chip；interact 模拟宿主回传
      // fileThumb（懒加载回执），缩略图据此上屏。
      png: PNG_RED,
      state: base({
        messages: [
          {
            kind: 'user',
            id: 'u-ref',
            text: '截图在 @/var/folders/xx/T/dsh-one-attachments/sess-1/img1.png，源码在 @/Users/a/dsh-one/src/index.ts，目录 @/Users/a/dsh-one/src/ 也看看。',
          },
          at('收到，我读一下截图和源码。'),
        ],
      }),
      interact: `(() => {
        window.postMessage({ type: 'fileThumb', path: '/var/folders/xx/T/dsh-one-attachments/sess-1/img1.png', mediaType: 'image/png', data: window.SCENARIOS['file-ref-bubble'].png }, '*')
      })()`,
      title: '@ 文件引用：图片提升附件区缩略图，行内不留长路径',
      expect: '用户气泡正文：截图在（行内 @img1.png 引用 chip，图标+短名，可点击）@img1.png，源码在（行内 @index.ts chip）@index.ts，目录 @src 保持行内 folder chip；附件区（气泡上方）两个 chip：img1.png = 红色 48px 缩略图 + 底部名称横幅「img1.png」（懒加载回执后），index.ts = 文档图标 + 短名 chip；无长路径文本。悬停行内 @img1.png chip 时对应附件缩略图 chip 高亮描边（mouseover 委托，真实交互 dev-ui-test 验收）。',
    },

    'file-ref-token': {
      // @ 附件交互：补全选中后输入框插入 @短名 token（canonical 记 mentionBindings，
      // 发送时展开），对应 staged 图片 chip 高亮描边。interact 投喂 filesPicked
      // 模拟粘贴附件的回投，再驱动输入 @截 → 选中候选行。
      png: PNG_RED,
      state: base({ messages: [] }),
      interact: `(() => {
        const s = window.SCENARIOS['file-ref-token']
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-1/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
        ] }, '*')
        setTimeout(() => {
          const input = document.getElementById('input')
          input.focus()
          input.value = '@img'
          input.setSelectionRange(4, 4)
          input.dispatchEvent(new Event('input'))
          setTimeout(() => {
            const rows = document.querySelectorAll('.slash-popup .menu-item')
            for (const row of rows) {
              if (row.textContent?.startsWith('@img1')) {
                // 弹窗行用 mousedown 完成补全（防止 textarea 失焦），模拟真实点击序列。
                row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                break
              }
            }
          }, 120)
        }, 100)
      })()`,
      title: '@ 附件：输入框短 token + 对应图片 chip 高亮',
      expect: '@ 补全弹窗顶部出现「Attachments」组标题（分割线），其下是 img1.png 附件候选（@img1.png 短名 + 右侧路径）；选中后输入框内容为「@img1.png」——显示为高亮 token（浅蓝底、圆角，由文本高亮层绘制——textarea 文字色透明、色调一致不重影），无长路径；composer 的截图缩略图 chip 底部名称横幅清晰显示「img1.png」（小字号、不截断）；点选后弹窗关闭——chip 无常驻高亮（高亮只在鼠标悬停 @token 时出现，场景无法模拟 hover，真实交互在 dev-ui-test 验收）。',
    },

    'mention-bindings-per-session': {
      // 按会话归档 mentionBindings：会话 A 里 @ 补全绑定同名文件后切到会话 B，
      // B 附加同名不同路径的文件时 token 不被 A 的残留绑定强制 (2)（按会话隔离，
      // B 拿到空绑定 Map）；B 里选中后输入框是 @img1.png 而非 @img1.png (2)。
      // 再切回 A：草稿（@img1.png）与绑定一起恢复——高亮层画回一处 .ref-token，
      // 且 dataset.path 是 A 的 canonical 路径（不是 B 的）。
      png: PNG_RED,
      state: base({ messages: [] }),
      stateB: base({ sessionId: 'sess-2', sessionTitle: '另一个会话', messages: [], statsLine: '0 条消息' }),
      interact: `(() => {
        const s = window.SCENARIOS['mention-bindings-per-session']
        const check = (patch) => { window.__mentionPerSession = { ...(window.__mentionPerSession || {}), ...patch } }
        // 步骤 1：会话 A 附加 /a/img1.png 并 @ 补全选中 @img1.png
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-A/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
        ] }, '*')
        setTimeout(() => {
          const input = document.getElementById('input')
          input.focus()
          input.value = '@img'
          input.setSelectionRange(4, 4)
          input.dispatchEvent(new Event('input'))
          setTimeout(() => {
            for (const row of document.querySelectorAll('.slash-popup .menu-item')) {
              if (row.textContent?.startsWith('@img1')) {
                row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                break
              }
            }
            check({ aToken: document.getElementById('input')?.value })
            // 步骤 2：切到会话 B（绑定归档 A、B 恢复空 Map），附加同名不同路径文件
            window.postMessage({ type: 'sessions', snapshot: (() => {
              const tree = window.sessionsTree('sess-2')
              tree.workspaces[0].sessions[1].sessionId = 'sess-2'
              tree.workspaces[0].sessions[1].label = '另一个会话'
              tree.activeSessionId = 'sess-2'
              return tree
            })() }, '*')
            window.postMessage({ type: 'state', state: s.stateB }, '*')
            setTimeout(() => {
              window.postMessage({ type: 'filesPicked', files: [
                { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-B/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
              ] }, '*')
              setTimeout(() => {
                const inputB = document.getElementById('input')
                inputB.focus()
                inputB.value = '@img'
                inputB.setSelectionRange(4, 4)
                inputB.dispatchEvent(new Event('input'))
                setTimeout(() => {
                  for (const row of document.querySelectorAll('.slash-popup .menu-item')) {
                    if (row.textContent?.startsWith('@img1')) {
                      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                      break
                    }
                  }
                  // 断言：B 里 token 不带 (2)（A 的残留绑定未污染）
                  const valueB = document.getElementById('input')?.value ?? ''
                  check({ bToken: valueB, contaminated: valueB.includes('(2)') })
                  // 步骤 3：切回 A——草稿与绑定一起恢复
                  window.postMessage({ type: 'state', state: s.state }, '*')
                  setTimeout(() => {
                    const inputA = document.getElementById('input')
                    const spans = Array.from(document.querySelectorAll('.ref-token'))
                    check({
                      restoredText: inputA?.value ?? null,
                      refTokens: spans.map((sp) => ({ text: sp.textContent, path: sp.dataset.path })),
                    })
                  }, 350)
                }, 160)
              }, 120)
            }, 250)
          }, 180)
        }, 100)
      })()`,
      title: '@ 绑定按会话归档：跨会话同名不 (2)，切回草稿与绑定一起恢复',
      expect: '会话 A 附加 /a/img1.png 并 @ 选中后输入框 @img1.png；切到会话 B（同名不同路径 /b/img1.png）再 @ 选中——输入框仍是 @img1.png，不带「 (2)」后缀（DOM 断言 window.__mentionPerSession.contaminated = false）；切回 A——输入框恢复 A 的草稿 @img1.png，高亮层画回恰一个 .ref-token（DOM 断言 window.__mentionPerSession.refTokens = [{text:"@img1.png", path:"@/var/folders/x/T/dsh-one-attachments/sess-A/img1.png"}]，path 是 A 的 canonical——binding 恢复的不是 B 的）。',
    },

    'ref-token-word-boundary': {
      // 词中 @ 不高亮：先经补全绑定 @img1.png，再把输入改成同时含词中
      // （a@img1.png b）与边界（@img1.png c）两处命中——高亮层只认扫描
      // 起点（边界校验）处按 key 最长匹配的结果，词中命中不画。
      png: PNG_RED,
      state: base({ messages: [] }),
      interact: `(() => {
        const s = window.SCENARIOS['ref-token-word-boundary']
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-1/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
        ] }, '*')
        setTimeout(() => {
          const input = document.getElementById('input')
          input.focus()
          input.value = '@img'
          input.setSelectionRange(4, 4)
          input.dispatchEvent(new Event('input'))
          setTimeout(() => {
            const rows = document.querySelectorAll('.slash-popup .menu-item')
            for (const row of rows) {
              if (row.textContent?.startsWith('@img1')) {
                // 与 file-ref-token 一致：mousedown 完成补全（防 textarea 失焦）。
                row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                break
              }
            }
            setTimeout(() => {
              const input2 = document.getElementById('input')
              input2.value = 'a@img1.png b @img1.png c'
              input2.setSelectionRange(input2.value.length, input2.value.length)
              input2.dispatchEvent(new Event('input'))
              const spans = Array.from(document.querySelectorAll('.ref-token'))
              window.__refTokenCheck = {
                count: spans.length,
                texts: spans.map((s2) => s2.textContent),
                layerText: document.querySelector('.ref-token-layer')?.textContent ?? null,
              }
            }, 180)
          }, 160)
        }, 120)
      })()`,
      title: '@ 输入框高亮：词中命中不高亮，边界命中照常高亮（boundTokenRanges）',
      expect: 'composer 输入「a@img1.png b @img1.png c」：文本高亮层只绘制一处 .ref-token（浅蓝底 @img1.png，落在第二处——边界命中）；第一处词中 a@img1.png 保持普通文本、无高亮背景（DOM 断言 window.__refTokenCheck = {count: 1, texts: ["@img1.png"]}）；两处文本都清晰可见、无长路径、无补全弹窗。',
    },

    'mention-bindings-recall': {
      // recall 反查：↑ 拉起历史消息时把 canonical 长路径换回显示短 token。
      // 先经补全绑定 @img1.png（模块内 mentionBindings），再按 ↑ 召回含
      // '@'/a/img1.png' 的历史消息——输入框应显示 @img1.png（与发送展开互逆），
      // 且高亮层绘制一个 .ref-token。
      png: PNG_RED,
      state: base({
        messages: [
          u('帮我看看 @/var/folders/x/T/dsh-one-attachments/sess-1/img1.png 这个截图'),
          at('收到，我看一下截图。'),
        ],
      }),
      interact: `(() => {
        const s = window.SCENARIOS['mention-bindings-recall']
        const check = (patch) => { window.__mentionRecall = { ...(window.__mentionRecall || {}), ...patch } }
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-1/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
        ] }, '*')
        setTimeout(() => {
          const input = document.getElementById('input')
          input.focus()
          input.value = '@img'
          input.setSelectionRange(4, 4)
          input.dispatchEvent(new Event('input'))
          setTimeout(() => {
            for (const row of document.querySelectorAll('.slash-popup .menu-item')) {
              if (row.textContent?.startsWith('@img1')) {
                row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                break
              }
            }
            setTimeout(() => {
              const input2 = document.getElementById('input')
              // 补全选中后光标在 token 后，要先回到行首再按 ↑（recall 只在首行触发）
              input2.setSelectionRange(0, 0)
              input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
              const spans = Array.from(document.querySelectorAll('.ref-token'))
              check({
                recalled: input2?.value ?? null,
                refTokens: spans.map((sp) => sp.textContent),
              })
            }, 200)
          }, 160)
        }, 100)
      })()`,
      title: 'recall 反查：↑ 历史 canonical 长路径还原为显示短 token',
      expect: '先经 @ 补全绑定 @img1.png（canonical 记在绑定 Map），光标回行首按 ↑ 召回历史消息「帮我看看 @/var/folders/x/T/dsh-one-attachments/sess-1/img1.png 这个截图」——输入框变为「帮我看看 @img1.png 这个截图」（canonical 长路径反查回显示短 token，与发送展开互逆）；高亮层恰好一个 .ref-token（@img1.png）。DOM 断言 window.__mentionRecall = {recalled: "帮我看看 @img1.png 这个截图", refTokens: ["@img1.png"]}。',
    },

    'file-ref-mixed': {
      // 附件候选混合验证：图片（临时目录 imgN）+ 粘贴文件（临时目录原名）+
      // 选择/右键文件（其他目录原路径），三种都在 @ 弹窗「附件」组候选里。
      png: PNG_RED,
      state: base({ messages: [] }),
      interact: `(() => {
        const s = window.SCENARIOS['file-ref-mixed']
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/var/folders/x/T/dsh-one-attachments/sess-1/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
          { name: 'note.md', path: '/var/folders/x/T/dsh-one-attachments/sess-1/note.md' },
          { name: 'plan.txt', path: '/Users/a/other-project/docs/plan.txt' },
        ] }, '*')
        setTimeout(() => {
          const input = document.getElementById('input')
          input.focus()
          input.value = '@'
          input.setSelectionRange(1, 1)
          input.dispatchEvent(new Event('input'))
        }, 120)
      })()`,
      title: '@ 附件候选：图片与文件（临时目录/其他目录）都在',
      expect: '@ 补全弹窗顶部「Attachments」组下出现三行：@img1.png（图片，缩略图）、@note.md（临时目录粘贴文件）、@plan.txt（其他目录文件）——文件与图片同等出现在附件候选；弹窗上方 composer 三个 staging chip（图片缩略图 + 两个文件图标 chip）。',
    },

    'paste-long-text': {
      // 长文本粘贴折叠：interact 构造 ClipboardEvent（DataTransfer text/plain 超阈值）
      // 触发 foldLongTextPaste → 宿主回投 filesPicked（pasted-1.txt）→ 光标处自动插
      // @ token。mock 宿主不回，interact 手动回投模拟。
      state: base({ messages: [] }),
      interact: `(() => {
        const input = document.getElementById('input')
        input.focus()
        const lines = Array.from({ length: 12 }, (_, i) => ('第 ' + (i + 1) + ' 行日志内容 lorem ipsum ' + i))
        const dt = new DataTransfer()
        dt.setData('text/plain', lines.join('\n'))
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        setTimeout(() => {
          window.postMessage({ type: 'filesPicked', files: [
            { name: 'pasted-1.txt', path: '/var/folders/x/T/dsh-one-attachments/sess-1/pasted-1.txt' },
          ] }, '*')
        }, 120)
      })()`,
      title: '长文本粘贴折叠：落盘附件 + 自动 @ token',
      expect: '输入框出现在光标处的 @pasted-1.txt 显示 token（文本高亮层，浅蓝底）；composer 附件区出现 pasted-1.txt 文件 chip（文档图标 + 短名）；粘贴的 12 行原文没有出现在输入框里。',
    },

    'attachment-file-images': {
      // 图片附件文件方式：历史消息的图片文件 chip（image: true）与 composer
      // staging chips（filesPicked 投喂，image + previewData）。interact 先回
      // fileThumb（模拟宿主懒加载缩略图），再投喂 filesPicked 让 composer 出现
      // 两张 staging chips（图片缩略图 + 普通文件图标）。
      png: PNG_RED,
      state: base({
        messages: [
          {
            kind: 'user',
            id: 'u-img',
            text: '这是界面截图，你看看。',
            files: [
              { name: 'img1.png', path: '/Users/a/dsh-one/dsh-attachments/img1.png', image: true },
              { name: 'note.md', path: '/Users/a/dsh-one/dsh-attachments/note.md' },
            ],
          },
          at('收到。截图已在工作区 `dsh-attachments/截图-0903-153812.png`，我直接读文件即可。'),
        ],
      }),
      interact: `(() => {
        const s = window.SCENARIOS['attachment-file-images']
        window.postMessage({ type: 'fileThumb', path: '/Users/a/dsh-one/dsh-attachments/img1.png', mediaType: 'image/png', data: s.png }, '*')
        window.postMessage({ type: 'filesPicked', files: [
          { name: 'img1.png', path: '/Users/a/dsh-one/dsh-attachments/img1.png', image: true, mediaType: 'image/png', previewData: s.png },
          { name: 'note.md', path: '/Users/a/dsh-one/dsh-attachments/note.md' },
        ] }, '*')
      })()`,
      title: '图片附件文件方式：历史缩略图 + composer staging chips',
      expect: '用户消息右侧附件区：图片文件渲染成 48px 红色方块缩略图（点击可预览，悬停 title 为短名，不出现长路径文本），note.md 显示为文档图标文件 chip；气泡正文只显示「这是界面截图，你看看。」（看不到 <attachment> 路径行）；composer 上方 chips 区：图片渲染红色缩略图 + 右上角 × 移除钮，note.md 文档图标 chip；底部发送按钮可用。',
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

    'commit-hash-found': {
      // 消息正文含 commit hash，interact 模拟宿主回传 commitInfo（found，带完整信息），
      // 再 dispatch mouseenter 弹出悬浮卡。用暗色主题：harness 亮色未定义
      // --vscode-textLink-foreground（VS Code 才注入），链接色/高亮在亮色下会回退黑。
      theme: 'dark',
      state: base({
        messages: [at('本轮合入完成。最近提交：`351a766`，详见提交说明。')],
      }),
      interact: `(() => {
        window.postMessage({ type: 'commitInfo', results: [{
          sha: '351a766', found: true, commitHash: '351a7664d4f6e86bb0ef58c94d84d0ee1fb9aa53',
          message: 'backlog: commit-hash-interactive 开发完成（doing → done）',
          fullMessage: 'backlog: commit-hash-interactive 开发完成（doing → done）\\n\\n- 追加人工验收提示\\n- 检查点详见条目',
          authorName: 'cgeng', authorEmail: 'cgeng@c3ng.com', commitDate: '2026-09-02',
          files: 1, insertions: 40, deletions: 2,
          githubUrl: 'https://github.com/imchangchang/dsh-one/commit/351a7664d4f6e86bb0ef58c94d84d0ee1fb9aa53',
        }] }, '*')
        setTimeout(() => {
          const chip = document.querySelector('.commit-hash.commit-hash-found')
          chip?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        }, 400)
      })()`,
      title: 'commit hash 先查后亮：found 点亮 + 悬浮详情卡（仿 VS Code）',
      expect: '助手消息文本里 "351a766" 渲染成 commit-hash chip：先查后亮——interact 回传 found 后 chip 为已点亮态（.commit-hash-found，链接色，可点击），且行内 code 里也不例外。400ms 后鼠标 enter 触发悬浮卡（.commit-card popover，定位 chip 下方）：内容自上而下——① 作者行：account 图标 + cgeng（链接色，mailto：cgeng@c3ng.com）+ history 图标 + 相对时间 (2026-09-02)；② message 全文：subject 行加粗「backlog: commit-hash-interactive 开发完成（doing → done）」+ 两行 body 灰字；③ 分隔线；④ 变更统计：「1 files changed, 40 insertions(+) 绿色, 2 deletions(-) 红色」；⑤ 分隔线 + 命令行：git-commit 图标 + 短 hash「351a766」（点开 commit）+ copy 图标 + Open on GitHub。卡片深色浮层、圆角、描边、阴影，宽 ≤420px。',
    },

    'commit-hash-not-found': {
      theme: 'dark',
      state: base({
        messages: [at('仓库没有这个提交：`deadbeef1234`。')],
      }),
      interact: `(() => {
        window.postMessage({ type: 'commitInfo', results: [{ sha: 'deadbeef1234', found: false }] }, '*')
      })()`,
      title: 'commit hash 先查后亮：仓库外 hash 灰显',
      expect: '"deadbeef1234" 渲染成 commit-hash chip；回传 found:false 后为未命中态（.commit-hash-unknown，微透明灰显，仍可点——点击由宿主提示「未找到该提交」）。截图核对：chip 灰显/微透明、等宽；不是高亮链接色（对比 commit-hash-found 场景）。',
    },

    'commit-hash-card-bottom-flip': {
      // 提交卡贴视口底部：长消息（含代码块）把滚动区钉底，最后一段的 commit hash 停在
      // 消息流末尾（composer 上方、视口下半部）。旧实现 positionPopover 只钳水平：below
      // 展开的卡会超出视口底边、被 iframe 边界裁掉（用户反馈「被 VS Code 界面挡住」）。
      // 修复后应翻到 chip 上方展开、整卡完整可见。浏览器窗口即 webview 视口（popover
      // position: fixed 相对它），几何与 VS Code 面板一致。
      theme: 'dark',
      state: base({
        messages: [at('第一段：这个场景验收 commit 悬浮卡的视口钳制。\n\n第二段：长消息把滚动区钉底，最后一段的提交 hash 停在消息流底部。\n\n第三段：卡片从 chip 下方展开时会超出视口底边，被 iframe 边界裁掉，统计和命令行不可见。\n\n第四段：修复后 positionPopover 垂直方向同样钳制视口——below 放不下时翻到 chip 上方。\n\n第五段：再多写几段，确保内容高度确定超过滚动区，贴底跟随把尾部钉住。\n\n第六段：这一段继续填高度，代码块之后是最后一段。\n\n```\nconst a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5\nconst f = 6\nconst g = 7\nconst h = 8\nconst i = 9\nconst j = 10\nconst k = 11\nconst l = 12\nconst m = 13\nconst n = 14\nconst o = 15\nconst p = 16\nconst q = 17\nconst r = 18\nconst s = 19\nconst t = 20\nconst u = 21\nconst v = 22\nconst w = 23\nconst x = 24\nconst y = 25\nconst z = 26\n```\n\n第七段：代码块后面的段落继续填充高度，让消息流超过滚动区高度、钉底生效。\n\n第八段：这一段之后是最后一段，提交 hash 将位于消息流最底部、composer 上方。\n\n第九段：本卡内容本身也拉长（body 多行），below 溢出判定更稳。\n\n第十段：再往下补几段，把 chip 压到视口下半部——below 展开必然溢出。\n\n第十一段：继续补高度，保证滚动区确实溢出、贴底跟随把尾部钉住。\n\n第十二段：最后一段之前的高度已足够，这段之后是收官段。\n\n最后一个自然段：本行靠底，提交 hash 是 `351a766`。')],
      }),
      interact: `(() => {
        window.postMessage({ type: 'commitInfo', results: [{
          sha: '351a766', found: true, commitHash: '351a7664d4f6e86bb0ef58c94d84d0ee1fb9aa53',
          message: 'fix(commit-hash): 悬浮卡贴面板底部翻到 chip 上方',
          fullMessage: 'fix(commit-hash): 悬浮卡贴面板底部翻到 chip 上方\\n\\n- 用户反馈：卡片被 VS Code 界面挡住\\n- 根因：positionPopover 只钳水平，below 展开溢出视口\\n- 修复：垂直方向钳制 + 放不下时翻侧\\n- 两侧都不够时钳到视口边缘\\n- body 多写几行把卡拉高，保证 below 溢出判定触发\\n- 卡片一旦翻转要在 chip 上方完整可见\\n- 再补一行，卡高更稳',
          authorName: 'cgeng', authorEmail: 'cgeng@c3ng.com', commitDate: '2026-09-02',
          files: 2, insertions: 14, deletions: 2,
          githubUrl: 'https://github.com/imchangchang/dsh-one/commit/351a7664d4f6e86bb0ef58c94d84d0ee1fb9aa53',
        }] }, '*')
        // commitInfo 是异步送达：监听 class 变化，chip 点亮（缓存已就绪）的同一
        // 微任务里立即悬停弹卡，卡片必然在 1.3s 截图前打开。
        const mo = new MutationObserver(() => {
          const chip = document.querySelector('.commit-hash.commit-hash-found')
          if (chip) {
            mo.disconnect()
            chip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          }
        })
        mo.observe(document.querySelector('.messages'), { subtree: true, attributes: true, attributeFilter: ['class'] })
      })()`,
      title: 'commit 悬浮卡贴面板底部：below 溢出视口时翻到 chip 上方',
      expect: '长消息滚动区钉底：最后一段的「351a766」commit-hash chip 位于消息流底部（composer 上方、视口下半部），found 点亮态。悬浮卡（.commit-card popover）出现在 chip **上方**（below 放不下 → 翻转，卡片下边缘与 chip 行上边缘间隔 ~6px），整卡完整可见——作者行（account + cgeng + 相对时间）、subject 加粗行 + 4 行 body 灰字、分隔线、变更统计（「2 files changed, 14 insertions(+) 绿色, 2 deletions(-) 红色」）、分隔线 + 命令行（git-commit 图标 + 短 hash 351a766 + copy + Open on GitHub）——卡片下边缘不贴视口底边、没有被裁半截，也没有滚动条截断内容；卡片深色浮层、圆角、描边、阴影，宽 ≤420px。',
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

    'mention-chips': {
      // 用户气泡引用 chip 全 kind（对齐 web projectUserText）：会话（references 驱动，
      // 可点击）+ 文件/文件夹（形态推断，纯展示）+ /命令（skill，无图标）+ 引用摘要行。
      state: base({
        messages: [
          {
            kind: 'user',
            id: rid('u'),
            text: '参考 @旧会话 的实现，看下 @src/ui/chat/webview.ts 和 @src/pure/ 目录，用 /help 看看思路',
            references: [{ sessionId: 'sess-3', label: '旧会话' }],
          },
          {
            kind: 'user',
            id: rid('u'),
            text: '带空格路径 @"src/ui/chatView.ts" 也看下',
          },
        ],
      }),
      title: '用户气泡引用 chip 全 kind',
      expect: '第一条用户气泡（右侧）：四个引用 chip 与正文同排依序——会话 chip（聊天气泡图标 + 链接色「旧会话」，可点击）；文件 chip（文档线条图标 + 「webview.ts」）；文件夹 chip（闭合文件夹图标 + 「pure」）；命令 chip（无图标 + 「/help」）。文件/文件夹 chip 悬停 title 为完整 @token（静态截图不核对）。气泡下方一行小号摘要「引用会话 · 旧会话」（对齐 web referenceSummary）。第二条气泡：带引号路径「chatView.ts」文件 chip（带文档图标），引号并入 chip 不残留。所有 chip 行内 flex、链接色、字重 500、与正文基线对齐。',
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
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: 'dsh-one', workspaceId: 'ws-main', workspaces: [
        { workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', title: 'dsh-one' },
        { workspaceId: 'ws-research', path: '/Users/cgeng/Workspaces/dsh-web', title: 'dsh-web research' },
        { workspaceId: 'ws-another', path: '/tmp/another-project', title: 'another-project' },
      ], agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' }, statsLine: undefined }),
      title: '空会话 hero',
      expect: '空会话 hero（无历史）：品牌区为**单个 DSH One 像素鲸鱼 logo**（品牌蓝 #2563EB，约 64px，游动动画），**无**官方 dsh 鲸鱼标、× 分隔符、「探索未至之境」标题与「预览版」徽章；其下 workspace 选择 chip（dsh-one，文件夹图标 + 名称 + chevron，可点击）+ preset 选择 chip（标准模式/深度思考）+ 大圆角 composer 卡（canSend 就绪）；composer 右下角发送按钮为**圆形图标按钮**（品牌蓝底、白色上箭头图标、无文字）；composer 右下角**无** contextBar——无「窗口未知」灰字占位、无进度条、无悬停说明（空白对话无任何上下文数据，切换模型后也不显示任何上下文指示）。',
    },

    'composer-running': {
      // 运行中：官方 primaryStops 交互——主按钮从发送箭头切换为停止方块，
      // 点击即 stop；没有独立的「停止」文字按钮。
      state: base({ running: true, canSend: true, messages: [u('跑一下测试')] }),
      title: 'composer 运行中：主按钮变停止',
      expect: '有消息的普通对话（非 hero）：composer 输入行右侧主按钮为**圆形品牌蓝底 + 白色停止方块图标**（不是发送箭头、没有「停止」文字按钮、没有第二个按钮）；点击该按钮发出 stop（可后续在交互态验证）。输入框仍可输入排队消息。',
    },

    'hero-preset-pending': {
      // 懒切换选中帧：preset 点选后 host 推回 pending 覆盖的 state（current 已
      // 变），hero 应保持不重建（chip 文字就地更新）——本场景验证 chip 显示
      // 新选中项，其余 hero 元素原样。
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: 'dsh-one', workspaceId: 'ws-main', workspaces: [
        { workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', title: 'dsh-one' },
      ], agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'deep' }, statsLine: undefined }),
      title: '空会话 hero：preset 懒切换选中帧',
      expect: '空会话 hero（无历史）：品牌区为**单个 DSH One 像素鲸鱼 logo**；preset chip 显示**深度思考**（懒切换选中帧，未发送前会话真实预设未变）；其余与 empty 场景一致（无标题、无官方鲸鱼、发送按钮为圆形图标按钮）。',
    },

    'hero-permission-pending': {
      // 懒切换选中帧：权限点选后 host 推回 pending 覆盖的 state，hero 保持
      // 不重建——本场景验证权限 pill 显示新选中项（图标 + 文字），且界面仍
      // 是空态 hero（没有命令节点、没变消息流）。
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: 'dsh-one', workspaceId: 'ws-main', workspaces: [
        { workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', title: 'dsh-one' },
      ], agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' }, permissions: { options: [
        { value: 'read-only', label: 'Read Only' },
        { value: 'workspace-write', label: 'Workspace Write' },
        { value: 'danger-full-access', label: 'Full access' },
      ], current: 'danger-full-access' }, statsLine: undefined }),
      title: '空会话 hero：权限懒切换选中帧',
      expect: '空会话 hero（无历史）：composer 底部权限 pill 显示 **Full access**（带感叹号护盾图标，懒切换选中帧；未发送前真实权限未变）；右侧发送按钮为圆形图标按钮；消息区**没有** /permission 命令节点、**仍是空态 hero**（未变消息流）。',
    },

    'model-pill-012': {
      // 0.1.2 修复后状态（backlog model-selector-012）：模型位 real label + 权限 pill 中文。
      // modelLabel 由宿主 sessionModels → modelLabelOf 生成（真机探针 + 单测覆盖，数据链路
      // 见 verify.model-selector-012.ledger.json），本场景验证 webview 渲染层把宿主值渲染出来。
      state: base({
        modelLabel: 'DeepSeek-V4-Flash-Vision-Exp Max',
        permissions: {
          options: [
            { value: 'read-only', label: '仅可查看' },
            { value: 'workspace-write', label: '工作区内修改' },
            { value: 'danger-full-access', label: '完全权限' },
          ],
          current: 'workspace-write',
        },
      }),
      title: '0.1.2 模型位真名 + 权限 pill 中文',
      expect: 'composer 底部：模型 pill 显示 **DeepSeek-V4-Flash-Vision-Exp Max**（真实模型名 + effort，不是「选择模型」占位）；权限 pill 显示**工作区内修改**（带权限图标）；会话列表/消息区不受影响；模型 pill 右侧无「›」之类多余元素。',
    },

    'permission-menu-zh': {
      // 中文权限菜单：选项 label 由宿主 applyPermissionsValue 本地化（permissionOptionLabel
      // 过 vscode.l10n.t，机器名 workspace-write → 工作区内修改），webview 渲染 options.label。
      state: base({
        modelLabel: 'DeepSeek-V4-Flash-Vision-Exp Max',
        permissions: {
          options: [
            { value: 'read-only', label: '仅可查看' },
            { value: 'workspace-write', label: '工作区内修改' },
            { value: 'danger-full-access', label: '完全权限' },
          ],
          current: 'workspace-write',
        },
      }),
      interact: `document.querySelector('[data-role="perm"]')?.click()`,
      title: '权限菜单中文选项',
      expect: '点击权限 pill 后弹出菜单：三行选项**仅可查看 / 工作区内修改 / 完全权限**，当前项（工作区内修改）行尾 ✓ 对勾；pill 本身仍显示工作区内修改。',
    },

    'workspace-picker-open': {
      // hero workspace chip 点击后弹 WorkspacePicker（对齐官方 Menu）：workspace
      // 列表 + 当前项对勾 + footer 两个添加入口。
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: 'dsh-one', workspaceId: 'ws-main', workspaces: [
        { workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', title: 'dsh-one' },
        { workspaceId: 'ws-research', path: '/Users/cgeng/Workspaces/dsh-web', title: 'dsh-web research' },
        { workspaceId: 'ws-another', path: '/tmp/another-project', title: 'another-project' },
      ], agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' }, statsLine: undefined }),
      title: '空会话 hero：workspace 选择器打开',
      interact: `document.querySelector('.hero-chips .hero-chip').click()`,
      expect: '点击 hero 的 workspace chip（dsh-one）后，chip 下方弹出选择器：3 行 workspace（文件夹图标 + 标题，dsh-one 行尾部 ✓ 对勾标记当前项）；分隔线下 footer 两个添加入口「添加已有文件夹…」「创建工作区…」；preset chip 与 composer 保持原样。',
    },

    'workspace-picker-empty': {
      // workspace 基线为空（如尚未建立任何 workspace）：picker 只显示添加入口，
      // 不弹空列表。官方此时直接进目录流程，dsh-one 退化为只弹添加入口。
      state: base({ sessionId: 'sess-blank', sessionTitle: undefined, messages: [], canSend: true, presetLabel: undefined, workspaceLabel: '未分组', workspaces: [], agentPreset: { options: [{ id: 'standard', label: '标准模式', description: '默认' }, { id: 'deep', label: '深度思考', description: '更强推理' }], current: 'standard' }, statsLine: undefined }),
      title: '空会话 hero：无 workspace（picker 只剩添加入口）',
      interact: `document.querySelector('.hero-chips .hero-chip').click()`,
      expect: '点击 hero 的 workspace chip（未分组）后弹出选择器：无 workspace 行，只有「添加已有文件夹…」「创建工作区…」两个添加入口（无分隔线）；chip 仍显示「未分组」标签。',
    },

    'dsh-not-found': {
      state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, serverError: 'dshNotFound', statsLine: undefined, hostOs: 'macos' }),
      title: '找不到 dsh（安装引导 + 非官方脚本块）',
      expect: '主区居中显示「dsh not found」+ 说明文案 + 「View install guide」按钮；按钮下方是脚本块：说明行（community one-liner…unofficial）+ 平台下拉按钮（深色圆角，显示 macOS + 下拉小箭头）+ 命令条（浅色圆角单行、命令以省略号截断、**无横向滚动条**，尾部复制图标按钮）；无 composer；侧边栏会话列表正常。',
    },

    'dsh-not-found-menu': {
      state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, serverError: 'dshNotFound', statsLine: undefined, hostOs: 'macos' }),
      title: '找不到 dsh（平台下拉展开）',
      interact: `document.querySelector('.install-script-platform')?.click()`,
      expect: '点击平台按钮后弹出下拉浮层：列表项 Windows / macOS / Linux，**macOS 项加粗带 ✓**（当前项）；浮层悬停在命令条上方不截断命令条；其余元素不变。',
    },

    'dsh-not-found-windows-chip': {
      state: base({ sessionId: null, sessionTitle: undefined, messages: [], canSend: false, presetLabel: undefined, serverError: 'dshNotFound', statsLine: undefined, hostOs: 'macos' }),
      title: '找不到 dsh（下拉切到 Windows 平台）',
      interact: `(() => { const b = document.querySelector('.install-script-platform'); if (b) b.click(); const it = Array.from(document.querySelectorAll('.install-script-menu-item')).find((e) => e.textContent === 'Windows'); if (it) it.click(); })()`,
      expect: '平台按钮变 Windows（下拉浮层已关闭，Windows 成当前项）；命令条变为 irm https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-install.ps1 | iex（省略号截断显示）；其余元素（说明行、复制按钮）不变。',
    },

    approval: {
      state: base({ pending: [{ kind: 'approval', rpcId: 'rpc-1', sessionId: 'sess-1', approvalId: 'appr-1', toolName: 'bash', reason: '允许执行 npm test 吗？' }] }),
      title: '权限批准（composer 接管面板）',
      expect: '输入区位置（composer 处）渲染接管面板，**不在消息流尾部**：面板 header「权限请求」+ 右上最小化按钮（chevron）；面板正文：工具名「bash」+ 原因「允许执行 npm test 吗？」+ 「允许一次/拒绝」两个按钮；消息流尾部**没有**旧的 pending 卡；普通 composer 输入框**不显示**（输入区被面板替换）。',
    },

    question: {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（composer 接管面板）',
      expect: '输入区位置渲染接管面板：header「等待你的回答」+ 最小化按钮（单题**无**分页器）；正文：问题「用哪种排序？」+ header「排序方向」+ 单项选择（最新优先/最旧优先 + **「其他」选项**，bullet ·）+ **「其他（自定义回答）」输入框初始隐藏** + 「提交」按钮（初始禁用——半透明不可点）；消息流尾部无 pending 卡，无普通 composer。',
    },

    'question-selected': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（已选一项，未提交）',
      interact: `document.querySelectorAll('.question-options .option-btn')[0]?.click()`,
      expect: '点击「最新优先」后：该选项高亮（selected outline，· 实心），**接管面板仍在**（没有提交——答案没有发走、对话没有继续）；**「其他（自定义回答）」输入框仍隐藏**（点选项后收起了自定义输入通道）；「提交」按钮变为可用（不透明）。',
    },

    'question-other': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（点「其他」选项展开输入框）',
      interact: `document.querySelectorAll('.question-options .option-btn')[2]?.click()`,
      expect: '点击「其他」后：**「其他」高亮**（selected outline），「最新优先/最旧优先」无高亮；**其下方出现「其他（自定义回答）」输入框**（visible，input 聚焦）；「提交」按钮**仍禁用**——只点「其他」未输文本不算已答。',
    },

    'question-other-typed': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（「其他」输入框里打字）',
      interact: `(() => { const opt = document.querySelectorAll('.question-options .option-btn')[2]; if (opt) opt.click(); const i = document.querySelector('.question-custom input'); if (i) { i.value = '可以再讨论一下'; i.dispatchEvent(new Event('input', { bubbles: true })) } })()`,
      expect: '「其他」输入框有文本「可以再讨论一下」；「最新优先/最旧优先」**无高亮**（打字即取消先前选项高亮——单选 custom 覆盖 selected 的视觉一致）；「其他」保持高亮（自定义回答通道激活）；「提交」按钮可用。',
    },

    'question-other-back-to-option': {
      state: base({ pending: [{ kind: 'question', rpcId: 'rpc-2', sessionId: 'sess-1', questions: [{ question: '用哪种排序？', header: '排序方向', options: [{ label: '最新优先' }, { label: '最旧优先' }] }] }] }),
      title: '工具提问（自定义输入后点回选项）',
      interact: `(() => { const opts = document.querySelectorAll('.question-options .option-btn'); if (opts[2]) opts[2].click(); const i = document.querySelector('.question-custom input'); if (i) { i.value = '可以再讨论一下'; i.dispatchEvent(new Event('input', { bubbles: true })) } if (opts[0]) opts[0].click() })()`,
      expect: '自定义输入后再点「最新优先」：该选项高亮、「其他」不再高亮；**「其他（自定义回答）」输入框隐藏、内容清空**（自定义草稿被选项覆盖）；「提交」按钮可用。',
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

    // ---- 交互场景：pending 接管不丢 composer 草稿（回归 composer-draft-lost-on-pending）----
    // 时序：输入草稿 → 宿主推来带 approval 的 state（composer 被面板替换）→
    // 点「Allow once」应答 → 宿主推回无 pending 的 state（composer 恢复）→
    // 断言 textarea#input.value 还是原草稿。步骤间用 MutationObserver 链接
    // （不用固定 setTimeout：后台 tab 定时器被浏览器节流，链接会断），截图停在
    // 恢复后的 composer。
    'pending-typing-draft': {
      state: base({}),
      title: '输入中 pending 到达 → 应答后草稿还在',
      interact: `(() => {
        const post = (m) => window.postMessage(m, '*')
        const state = () => ({
          sessionId: 'sess-1', sessionTitle: 'DSH One 示例会话',
          messages: [
            { kind: 'user', id: 'u-1', text: '你帮我看看这个插件的架构，总结一下核心思路。' },
            { kind: 'assistant', id: 'a-1', complete: true, turnEnd: true, blocks: [{ type: 'text', text: '这个插件是 dsh 与 VSCode 的桥接。' }] },
          ],
          pending: [], running: true, canSend: true, modelLabel: 'DeepSeek-V4-Flash High', presetLabel: '标准模式', statsLine: '2 条消息 · 45s',
        })
        const ta = document.getElementById('input')
        if (!ta) return
        ta.value = '输入到一半的草稿——pending 应答后必须还在'
        ta.dispatchEvent(new Event('input'))
        // 宿主推来审批 pending：composer 被面板替换（接管帧应把草稿暂存）
        const s = state()
        s.pending = [{ kind: 'approval', rpcId: 'rpc-1', sessionId: 'sess-1', approvalId: 'appr-1', toolName: 'bash', reason: '允许执行 npm test 吗？' }]
        post({ type: 'state', state: s })
        const root = document.getElementById('app')
        const onPanel = new MutationObserver(() => {
          const allow = [...document.querySelectorAll('.pending-panel button')].find((b) => (b.textContent || '').trim() === 'Allow once')
          if (!allow) return
          onPanel.disconnect()
          // 用户在面板里应答，随后宿主推回无 pending 的 state
          allow.click()
          post({ type: 'state', state: state() })
          const onInput = new MutationObserver(() => {
            const input = document.getElementById('input')
            if (!input) return
            onInput.disconnect()
            window.__draftRestored = input.value
            document.title = 'DRAFT-RESTORED:' + input.value
          })
          onInput.observe(root, { childList: true, subtree: true })
        })
        onPanel.observe(root, { childList: true, subtree: true })
      })()`,
      expect: '恢复后的 composer 输入框里还是应答前输入的那段草稿「输入到一半的草稿——pending 应答后必须还在」（输入区高亮层绘制，非占位符）；pending 面板已消失；无报错（旧回归：pending 帧 autoGrow 对 null 抛 TypeError，吞掉渲染尾部）。',
    },

    todos: {
      state: base({ todos: [{ content: '梳理架构', status: 'completed' }, { content: '写测试', status: 'in_progress' }, { content: '发版', status: 'pending' }] }),
      title: 'todo 清单卡',
      expect: 'composer 上方一条可折叠的「任务 N 已完成 · M 进行中 · K 待处理」摘要卡；内容含三个 todo 项及其状态。',
    },

    // ---- plan 状态 chip（对齐官方 dsh web PlanChip；plan-mode-chip 合入时漏的场景）----
    'plan-chip': {
      state: base({ plan: { active: true, pending: false } }),
      title: 'Plan 状态 chip（plan 模式开启）',
      expect: 'composer 输入区 footer（权限 pill 与模型 pill 之间）出现黄色 warn 风格「Plan」chip（含关闭图标），点击会发送 /plan off；plan 投影缺失或 active=false 时 chip 不出现。',
    },

    // ---- goal 条幅（对齐官方 GoalBar / input.dock id=goal order 10）----
    'goal-active': {
      state: base({ goal: { id: 'g-1', revision: 3, objective: '给 dsh-one 补 goal 模式条幅，对齐 dsh web 的进行中目标条幅（暂停/编辑/删除）', phase: 'active', maxGoalRounds: 16 } }),
      title: '目标条幅（进行中）',
      expect: 'composer 上方、todo/queue 缺席时单独一条 36px 高横条：左起 goal 图标 + 「进行中的目标」标签 + 截断的 objective（超长省略号）+ 右侧三个图标按钮（悬停提示：暂停目标/编辑目标/清除目标）；无「恢复」按钮；条幅与 composer 之间只有一条分隔线。',
    },
    'goal-paused': {
      state: base({ goal: { id: 'g-1', revision: 4, objective: '给 dsh-one 补 goal 模式条幅', phase: 'paused', maxGoalRounds: 16 } }),
      title: '目标条幅（已暂停）',
      expect: '条幅标签变为「已暂停的目标」；右侧操作按钮变为：恢复目标（播放图标）+ 编辑目标 + 清除目标，没有「暂停」按钮。',
    },
    'goal-blocked': {
      state: base({ goal: { id: 'g-1', revision: 5, objective: '给 dsh-one 补 goal 模式条幅', phase: 'blocked', maxGoalRounds: 16, blockedReason: { code: 'goal-round-limit', message: '连续多轮无进展，目标受阻' } } }),
      title: '目标条幅（受阻）',
      expect: '条幅标签变为「受阻的目标」；整条悬停 title 显示受阻原因（blockedReason.message）；右侧操作按钮为 编辑目标 + 清除目标（无暂停/恢复）。',
    },
    'goal-complete': {
      state: base({ goal: { id: 'g-1', revision: 6, objective: '给 dsh-one 补 goal 模式条幅', phase: 'complete', maxGoalRounds: 16 } }),
      title: '目标条幅（已完成不渲染）',
      expect: 'composer 上方没有任何目标条幅（complete 目标不渲染）；页面与无 goal 状态完全一致，没有残留图标或占位。',
    },
    'goal-stack': {
      state: base({
        todos: [{ content: '梳理架构', status: 'completed' }, { content: '写测试', status: 'in_progress' }],
        goal: { id: 'g-1', revision: 3, objective: '给 dsh-one 补 goal 模式条幅', phase: 'active', maxGoalRounds: 16 },
        queue: [
          { id: 'q-1', placement: 'queued', text: '帮我看看 dev-finish 脚本', editText: '帮我看看 dev-finish 脚本' },
          { id: 'q-2', placement: 'queued', text: '把 backlog 条目挪到 done', editText: '把 backlog 条目挪到 done' },
        ],
      }),
      title: '目标条幅与 todo/queue 叠放',
      expect: 'composer 上方垂直叠放三条：最上 todo 清单卡（可折叠「任务…」）、中间目标条幅（进行中的目标）、最下排队 dock（「2 条排队消息」折叠 header）；三者各一条分隔线、无重叠；顺序为 todo → goal → queue → composer。',
    },
    'goal-editing': {
      state: base({ goal: { id: 'g-1', revision: 3, objective: '给 dsh-one 补 goal 模式条幅', phase: 'active', maxGoalRounds: 16 } }),
      interact: `document.querySelector('.goal-bar-btn[aria-label="编辑目标"]')?.click()`,
      title: '目标条幅（编辑态）',
      expect: '点击编辑后：条幅变成单行输入框（预填当前 objective，自动聚焦）+ 右侧两个图标按钮（保存目标：对勾；取消编辑：叉号）；预填非空所以保存按钮初始可用；条内无报错。',
    },

    // ---- 等待插话（steering 待落地）----
    'steering-pending': {
      state: base({
        running: true,
        queue: [
          {
            id: 'q-1', placement: 'steering',
            text: '[图片 ×1] [文件 ×1] 等等，先停下，看看 main 分支状态。',
            editText: '等等，先停下，看看 @[旧会话](dsh-session:InNlc3MtMyI) 的状态。\n<attachment>/Users/cgeng/Workspaces/dsh-one/README.md</attachment>',
            images: [{ attachmentId: 'steer-img-1', mediaType: 'image/png', name: 'chart.png' }],
            files: [{ name: 'README.md', path: '/Users/cgeng/Workspaces/dsh-one/README.md' }],
          },
        ],
      }),
      title: '等待插话消息（正常气泡 + 处理中圆圈）',
      expect: '对话流末尾（turn-status「Deep diving...」行之后）显示一条与正常用户消息一致的气泡组（不透明、无「等待插话」徽章），气泡左侧同一行紧贴一个旋转的处理中圆圈（spinner，蓝色圆环），整体右对齐；同一行只有一个圆圈；气泡上方一行两个同尺寸附件方块：左侧图片缩略图（红色）、右侧文件框（README.md）；气泡内「@旧会话」是链接色会话 chip（按钮形态，可点击打开会话），气泡下方有引用摘要行「引用会话 · 旧会话」；输入框上方没有这条消息的排队条目。',
      interact: `postMessage({ type:'attachmentData', attachmentId:'steer-img-1', mediaType:'image/png', data:'${PNG_RED}' }, '*');`,
    },

    'steering-pending-narrow': {
      // 回归锚点：676px 消息列宽下气泡 max-width:85% 按整行解析（不按
      // shrink-to-fit 的包含块），气泡不被压窄提前换行——interact 把聊天列
      // 收窄到 676px 复现原报告列宽。
      state: base({
        running: true,
        queue: [
          { id: 'q-1', placement: 'steering', text: '比如说remote ssh这个插件', editText: '比如说remote ssh这个插件' },
        ],
      }),
      interact: `(() => {
        const col = document.querySelector('.chat-col')
        if (col) { col.style.flex = 'none'; col.style.width = '676px'; col.style.minWidth = '676px' }
      })()`,
      title: '等待插话（676px 窄列宽：气泡单行）',
      expect: '对话流末尾（turn-status 行之后）显示气泡「比如说remote ssh这个插件」完整一行（不提前换行），气泡左侧同一行紧贴处理中圆圈（spinner），整体右对齐；气泡宽度≈内容自然宽，与插话落地后的正式用户消息一致。',
    },

    'composer-clear-after-send': {
      // 运行中 Enter 排队发送后，高亮层不得残留发送前的文字（「鬼影」叠在
      // 占位符上）——输入框 value 与 ref-token-layer 必须同步清空。keepComposer
      // 保活帧（签名未变）不重建输入区，清空收尾由 sendCurrent 就地完成。
      state: base({ running: true }),
      interact: `(() => {
        const i = document.getElementById('input')
        if (!i) return
        i.focus()
        i.value = '等等，先停下，看看状态。'
        i.dispatchEvent(new Event('input'))
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      })()`,
      title: '运行中 Enter 排队发送：输入区无鬼影残留',
      expect: '输入框 value 为空，仅显示浅灰占位符「Type a message; Enter queues, ⌘Enter steers now, ↑ edits the queued message, Esc interrupts」；输入框上方高亮层（ref-token-layer）没有任何文字（不残留发送前的「等等，先停下，看看状态。」）；主按钮显示停止图标（运行中）；无消息流之外的异常浮层。',
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

    'context-switch-window-unknown-blank': {
      state: base({
        // 空白对话切到未观察窗口模型的旧实现载荷：裸占位（无已用量采样）。
        // 数据层已不产生该状态；webview 防御性当无数据显示，绝不画空占位。
        contextUsage: { windowUnknown: true },
      }),
      title: 'contextBar：空白对话切模型（无采样）不显示占位',
      expect: 'composer 右下角**无** contextBar：没有「窗口未知」灰字占位、没有进度条、没有可点击区域，更没有悬停/点开面板；页面与未发生过模型切换的对话一致——空白对话没有任何上下文数据可标。',
    },

    // ================= 侧栏 sessions 面板（拆分后独立 webview） =================

    'sessions-dsh-not-found': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree(null)
        // 服务启动失败：找不到 dsh 可执行文件 → 面板空态应显示安装引导 + 脚本块。
        s.serverState = 'error'
        s.dshNotFound = true
        s.hostOs = 'macos'
        s.workspaces = []
        s.workspaceDirectory = []
        s.baselineReady = true
        return s
      })(),
      title: '侧栏面板（找不到 dsh：安装引导 + 非官方脚本块）',
      expect: '整个列表区是「dsh not found」空态：标题 + 说明文案 + 「View install guide」按钮；按钮下方脚本块：说明行（community one-liner…unofficial）+ 平台下拉按钮（深色圆角，macOS + 下拉箭头）+ 命令条（浅色圆角单行、命令 curl -fsSL https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-install.sh | bash 省略号截断、无横向滚动条，尾部复制图标）；**侧栏窄容器：命令条换行到平台按钮下方（上下排列，命令条占满宽度）**；无任何会话行/workspace 组；头部工具栏照常显示。',
    },

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
      expect: '头部工具栏（搜索框/排序/刷新/折叠全部/添加工作区）；搜索框下一行分组栏（左 All workspaces ▼ + 右 +）；dsh-one 组：vscode 标签、文件夹染蓝（组内有 active 行）、组名右侧角标（环 1 → 运行中 + 绿点 1 → 未读）、「sess-4 当前附加的会话」行高亮（active）；行首状态槽：sess-1 像素环、sess-2 未读绿点 + 标题加粗、sess-3 置顶图钉（槽位空时）；workspace 行尾 hover 动作仅结构存在（截图为静态，不核对 hover）；dsh-web research 组：sess-5 黄色待审批点（pendingInteraction）；未分组虚拟组显示「sess-6 未分组里的孤儿会话」。',
    },

    'sessions-baseline-loading': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        // 服务刚 running、基线未拉到：空工作区列表 + baselineReady=false，
        // 面板应停留在 Loading，而不是按「没有 workspace」渲染未分组组头。
        s.baselineReady = false
        s.workspaces = []
        return s
      })(),
      title: '侧栏面板（启动过渡态：基线未就绪）',
      expect: '整个列表区只有居中灰字「Loading…」（sessions-empty），**无**「添加工作区」引导、「未分组」组头/新建按钮、无任何会话行或 workspace 组；头部工具栏照常显示。',
    },

    'sessions-no-workspaces': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        // 基线已就绪但确实没有任何真实 workspace：与「未就绪」对照——
        // 「添加工作区」引导 + 「未分组」空组头（新建未分组对话入口）应照常显示。
        s.baselineReady = true
        s.workspaces = [{ workspaceId: UNGROUPED, path: '', label: '未分组', isCurrent: false, sessions: [] }]
        s.workspaceDirectory = [] // 没有真实 workspace → 分组栏「全部工作区」计数 0
        return s
      })(),
      title: '侧栏面板（基线就绪：确实没有 workspace）',
      expect: '列表上方「添加工作区」引导（No workspaces yet…），下方「未分组」组头（文件夹图标 + 组名「未分组」，行尾「+」新建按钮仅结构存在——截图为静态，不核对 hover），无任何会话行；头部工具栏照常显示。',
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
      expect: '点击会话行尾 ⋯ 后弹出菜单，自上而下：选择多个（Select multiple）/ 重命名 / 置顶（带 ✓ 选中态）/ 标为未读 / 分叉会话 / 复制引用 / 归档会话；「复制会话 ID」不在菜单里；置顶会话的菜单项「置顶」带 checked；全部项可用（无 disabled 灰置）。',
    },

    'sessions-recycle-drawer': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree()
        s.recycleBin = ['sess-4', 'sess-5', 'sess-6']
        s.recycleWorkspaces = [
          {
            workspaceId: 'ws-main', path: '/Users/cgeng/Workspaces/dsh-one', label: 'dsh-one', isCurrent: true,
            sessions: [
              sess('sess-4', '回收站里的会话一', '昨天'),
              sess('sess-5', '回收站里的会话二', '2 天前', { unread: true }),
            ],
          },
          {
            workspaceId: 'ws-gone', path: '/gone', label: '已删除的目录', isCurrent: false,
            sessions: [sess('sess-6', '软删目录会话', '上周')],
          },
        ]
        s.recycleCollapsed = []
        return s
      })(),
      interact: `document.querySelector('.recycle-entry')?.click()`,
      theme: 'dark',
      title: '侧栏面板（回收站抽屉：半栏叠加 + 提手 + 放大清空图标）',
      expect: '点击底部「Recycle bin (3)」入口后抽屉从面板底部滑出，占约一半高度：顶部提手横条（grab 光标区）；抽屉头 = ▼ Back 收起按钮（单个下拉箭头，无重复「‹」）+ 标题「Recycle bin」右紧跟计数徽标 3（与标题同组，不挤到行尾）+ 垃圾桶图标按钮（34px 点击区、22px 图标、悬停提示 Empty recycle bin；与「Restore all」视觉相称）+ 「Restore all」；会话按原 workspace 分组（组头 dsh-one 计数 2 / 已删除的目录 计数 1，各带折叠箭头。未分组虚拟组不出现——没有可归组的回收站会话）；主列表上半部仍可见（dsh-one / dsh-web research 组头与底部的回收站入口…入口被抽屉盖住属预期）。',
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
      expect: '运行中会话（行首像素环）的 ⋯ 菜单：选择多个/重命名/置顶/分叉/复制引用正常；「标为已读/未读」与「归档会话」灰置（.menu-item.disabled）；悬停「归档会话」项时其下方出现 tooltip 气泡「运行中的会话不能归档」；无「复制会话 ID」。',
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

    'sessions-selection-mode': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [
          sess('sess-1', 'DSH One 示例会话', '3 小时前'),
          sess('sess-7', '另一个待归档会话', '1 小时前'),
          sess('sess-2', '运行中的会话', '5 小时前', { running: true }),
          sess('sess-3', '未读的会话', '昨天', { unread: true }),
        ]
        s.workspaces[1].sessions = [sess('sess-5', 'dsh web 可展开 UI 调研', '9 小时前')]
        s.workspaces[2].sessions = [sess('sess-6', '未分组里的孤儿会话', '2 小时前')]
        s.collapsed = ['ws-research']
        s.unread = ['sess-3']
        return s
      })(),
      // 打开 ⋯ 菜单 → 点「选择多个」进模式 → 点 ws-main 组头（组内有置灰的
      // sess-2/sess-3）→ 该组无法真正全选：飘提示 + 组头保持半选 →
      // 再点 ws-research 组头（全选态）。全同步链（每次点击后 DOM 同步重建，
      // 后续查询都重新取），避免测试脚本在 setTimeout 链完成前截图。
      interact: `(() => {
        document.querySelector('.session-row[data-session-id="sess-1"]')?.querySelector('.row-action')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent.includes('Select multiple'))?.click()
        document.querySelector('.workspace-group[data-workspace-id="ws-main"] .select-checkbox input')?.click()
        document.querySelector('.workspace-group[data-workspace-id="ws-research"] .select-checkbox input')?.click()
      })()`,
      title: '侧栏面板（多选归档模式）',
      expect: '多选模式态：顶部搜索框下出现操作条（.selection-bar），左 primary 按钮「Archive 3 selected」+ 右「Cancel」secondary；三个组头行首都有复选框；ws-main 组头是部分选中（横线半选）——组内可归档的 sess-1/sess-7 都已勾，但有置灰的 sess-2（运行中）/sess-3（未读），所以组头不能是全选；组头复选框附近有瞬态提示气泡「该组有会话无法归档，不能全部选中」（截图时仍在显示）；dsh-web research 组头（折叠态）复选框为全选勾；未分组组头未勾、其下 sess-6 未勾；会话行行尾 ⋯ 按钮已消失；sess-2/sess-3 复选框灰置。',
    },

    'sessions-selection-modal': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [
          sess('sess-1', 'DSH One 示例会话', '3 小时前'),
          sess('sess-7', '另一个待归档会话', '1 小时前'),
        ]
        s.workspaces[1].sessions = [sess('sess-5', 'dsh web 可展开 UI 调研', '9 小时前')]
        s.workspaces[2].sessions = [sess('sess-6', '未分组里的孤儿会话', '2 小时前')]
        return s
      })(),
      interact: `(() => {
        document.querySelector('.session-row[data-session-id="sess-1"]')?.querySelector('.row-action')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent.includes('Select multiple'))?.click()
        document.querySelector('.session-row[data-session-id="sess-1"]')?.click()
        document.querySelector('.session-row[data-session-id="sess-5"]')?.click()
        document.querySelector('.selection-bar button')?.click()
      })()`,
      title: '侧栏面板（批量归档确认框：默认折叠）',
      expect: '点「归档选中的 2 个」后页面内弹出 modal：深色半透明遮罩 + 居中白色卡片；标题「Archive 2 sessions?」、副标题「Archived sessions will be hidden from the list.」；树区两个组头各带数量（dsh-one · 1 / dsh-web research · 1）且明细默认折叠（.modal-group.collapsed，组头可展开）；底部右侧「Cancel」secondary +「Archive」primary 按钮。',
    },

    'sessions-selection-modal-open': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [
          sess('sess-1', 'DSH One 示例会话', '3 小时前'),
          sess('sess-7', '另一个待归档会话', '1 小时前'),
        ]
        s.workspaces[1].sessions = [sess('sess-5', 'dsh web 可展开 UI 调研', '9 小时前')]
        s.workspaces[2].sessions = [sess('sess-6', '未分组里的孤儿会话', '2 小时前')]
        return s
      })(),
      interact: `(() => {
        document.querySelector('.session-row[data-session-id="sess-1"]')?.querySelector('.row-action')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent.includes('Select multiple'))?.click()
        document.querySelector('.session-row[data-session-id="sess-1"]')?.click()
        document.querySelector('.session-row[data-session-id="sess-5"]')?.click()
        document.querySelector('.selection-bar button')?.click()
        const heads = [...document.querySelectorAll('.modal-group-head')]
        heads.forEach((h) => h.click())
      })()`,
      title: '侧栏面板（批量归档确认框：展开明细）',
      expect: '确认框 modal 内两组都展开：dsh-one 组下会话行「DSH One 示例会话 · 3 小时前」、dsh-web research 组下「dsh web 可展开 UI 调研 · 9 小时前」（名称 + 右侧相对时间）；组头三角箭头旋转（展开态），组头数量角标保留；底部 Cancel/Archive 按钮照常；弹窗不超屏。',
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

    // ================= 工作区右键菜单（6 项 / 分组…子菜单 / 归档该工作区全部） =================

    'sessions-workspace-menu': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.classList.add('menu-open')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
      })()`,
      title: '侧栏面板（工作区行右键菜单：6 项）',
      expect: '右键 ws-main 工作区行弹出 popover 菜单：首行标题「Workspace: dsh-one」（操作对象显式化）；自上而下 6 项：复制文件夹引用（copy 图标）/ 分组…（齿轮图标 + 右缘 › 子菜单指示）/ 归档该工作区全部会话（archive 图标，该组有可归档会话故可用）/ 在新窗口打开文件夹（folderOpen 图标）/ 复制路径（copy 图标）/ 从列表移除（trash 图标）；无「重命名」「只显示此工作区」等不做项；菜单下方无分隔线（6 项同一段）。',
    },

    'sessions-workspace-menu-groups': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Groups…'))?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      })()`,
      title: '侧栏面板（分组… 子菜单：hover 展开 + 与顶层菜单并存）',
      expect: '右键 ws-main 弹出顶层菜单后，**悬停**「分组…」即展开二级 popover（不必点击）：二级菜单锚在「分组…」项右侧、右缘对齐；**顶层 6 项菜单完整保留、与二级菜单并存**（标题 Workspace: dsh-one、复制文件夹引用、分组…、归档该工作区全部会话、在新窗口打开文件夹、复制路径、从列表移除都仍在原位）；二级菜单三个组行自上而下「演示 2 ✓」「开发 1 ✓」「日常 0」（勾选态来自 ws-main 的归属 groupMembership；「日常」未勾无 ✓、计数 0 仍列出）；勾选行带 ✓ 于行尾；组名 + 右侧计数 + ✓ 布局在列。',
    },

    'sessions-workspace-menu-groups-click': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Groups…'))?.click()
      })()`,
      title: '侧栏面板（分组… 子菜单：点击展开兜底 + 与顶层菜单并存）',
      expect: '与 hover 场景同布局，但由**点击**「分组…」展开（触屏/键盘兜底路径）：二级菜单锚在「分组…」项右侧，顶层 6 项菜单完整保留、与二级菜单并存，三个组行「演示 2 ✓」「开发 1 ✓」「日常 0」勾选态正确。',
    },

    'sessions-workspace-menu-groups-leave': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
        const items = [...document.querySelectorAll('.menu-item')]
        const anchor = items.find((i) => i.textContent?.includes('Groups…'))
        anchor?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        // hover 移出：指针落到顶层菜单其它项（如复制文件夹引用）
        const other = items.find((i) => i.textContent?.includes('Copy folder reference'))
        other?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      })()`,
      title: '侧栏面板（分组… 子菜单：hover 移出后收起）',
      expect: 'hover 展开「分组…」二级菜单后，指针移出到顶层菜单其它项（复制文件夹引用）：二级 popover 收起（截图时已过 140ms 延时），顶层 6 项菜单仍完整保留、无任何残留二级菜单。',
    },

    'sessions-workspace-archive-modal': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [
          sess('sess-1', 'DSH One 示例会话', '3 小时前'),
          sess('sess-7', '另一个可归档会话', '1 小时前'),
          sess('sess-2', '运行中的会话', '5 小时前', { running: true }),
        ]
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Archive all sessions in this workspace'))?.click()
      })()`,
      title: '侧栏面板（归档该工作区全部会话：确认弹窗 + 跳过说明）',
      expect: '点「归档该工作区全部会话」后页面内弹出确认弹窗（selection-modal）：标题「Archive 2 sessions?」；副标题「Archived sessions will be hidden from the list. 1 session(s) cannot be archived and were skipped.」；树区一个组「dsh-one · 2」明细展开，含 2 条可归档会话行（运行中的 sess-2 不在列，被跳过）；底部「Cancel」secondary +「Archive」primary；遮罩半透明。',
    },

    'sessions-workspace-menu-archive-disabled': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-1')
        s.workspaces[0].sessions = [sess('sess-1', '运行中的会话', '3 小时前', { running: true })]
        return s
      })(),
      interact: `(() => {
        const head = document.querySelector('.workspace-group[data-workspace-id="ws-main"] .workspace-row')
        head?.classList.add('menu-open')
        head?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }))
        setTimeout(() => {
          const items = [...document.querySelectorAll('.menu-item.disabled')]
          const last = items[items.length - 1]
          if (last) last.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        }, 150)
      })()`,
      title: '侧栏面板（无归档会话的工作区：一键归档禁用 + 悬停提示）',
      expect: '工作区内全部会话运行中（无任何可归档会话）：右键菜单「归档该工作区全部会话」灰置（.menu-item.disabled）；悬停该项时其上方出现 tooltip 气泡「该工作区没有可归档的会话」（tooltip 优先放锚点上方，顶部空间不足时放下方）；其余 5 项（复制文件夹引用/分组…/新窗口/复制路径/从列表移除）正常可用。',
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

    // ================= 工作区分组（tag 过滤 + 下拉选择器） =================

    // 分组数据构造：演示（ws-main + ws-research）、开发（ws-main）、日常（空组）+ 一个未打标 workspace。
    'sessions-groups-dropdown': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `document.querySelector('.ws-group-select')?.click()`,
      title: '侧栏面板（工作区分组栏：全部工作区 + 下拉菜单）',
      expect: '搜索框下新出一行分组栏：左「All workspaces ▼」（加粗 + 下拉箭头），右「+」（New group 快捷按钮）；点击后弹下拉菜单：①首项「All workspaces 2」（全部 workspace 计数=2，当前选中 ✓ checked）；②各分组按序「演示 2 / 开发 1 / 日常 0」（右侧计数角标）；③分隔线下一项「Manage groups…」（齿轮图标）。主列表不受影响（全部工作区 = 现状：两个真实组 + 未分组组都在）。',
    },

    'sessions-groups-selected': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        s.activeGroupId = 'g-demo'
        // store 快照已按选中组预过滤（本场景模拟其结果：组内两个 workspace，
        // 无未分组虚拟组）；fixture 未经过 host，这里手写过滤后的 workspaces。
        s.workspaces = s.workspaces.filter((w) => w.workspaceId !== UNGROUPED)
        return s
      })(),
      title: '侧栏面板（选中「演示」分组：只显示组内 workspace）',
      expect: '分组栏左按钮显示「演示 ▼」（选中的组名）；列表**只**显示「演示」组的两个 workspace（dsh-one、dsh-web research）——未分组组头**不出现**；未打标的 workspace 不出现（未打标只在「全部工作区」显示）；分组栏右侧「+」保留。',
    },

    'sessions-groups-selected-search': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        s.activeGroupId = 'g-dev' // 只有 ws-main
        s.query = '重构'
        s.workspaces = s.workspaces.filter((w) => w.workspaceId === 'ws-main')
        s.workspaces[0].sessions = [sess('sess-2', '重构 sessionStore', '5 小时前')]
        return s
      })(),
      interact: `(() => { const i = document.querySelector('.sessions-search'); i.value = '重构'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      title: '侧栏面板（分组 + 搜索叠加：先分组后搜索）',
      expect: '分组栏显示「开发 ▼」；搜索框显示「重构」；列表：ws-main 组展开，其下命中行「重构 sessionStore」（组内只有这一个 workspace 且命中）；dsh-web research（不在「开发」组）不出现；未分组组头不出现——分组过滤与搜索叠加（先分组后搜索）。',
    },

    'sessions-groups-empty': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        s.activeGroupId = 'g-daily' // 空组：没有任何 workspace 归组
        s.workspaces = [] // store 预过滤结果（组内 0 个 workspace，未分组也不显示）
        return s
      })(),
      title: '侧栏面板（选中空分组：组专属空态）',
      expect: '分组栏左按钮显示「日常 ▼」；列表区为**组专属空态**：居中提示「This group has no workspaces yet. Tag workspaces in "Manage groups…" first.」+ 补充行「You can also create a new group from the row above.」+ secondary 按钮「Manage groups…」；**不是**「No workspaces yet. Add an existing folder...」的默认引导；分组栏顶部照常。',
    },

    'sessions-groups-manage': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        s.activeGroupId = 'g-demo'
        return s
      })(),
      interact: `(() => {
        document.querySelector('.ws-group-select')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Manage groups'))?.click()
      })()`,
      title: '侧栏面板（管理分组视图：组行 + 工作区打标勾选）',
      expect: '点「Manage groups…」后弹出管理视图弹层（居中卡片）：① 头部「Manage groups」+ 右上 ✕ 关闭；② 「Groups」区：三行组（演示 2 / 开发 1 / 日常 0），每行最左为六点拖拽手柄，行尾 ✎（Rename group）+ 🗑（Delete group）按钮；当前选中组「演示」行高亮（selected 背景）；③ 区底是新建行（placeholder「Group name」输入框 + 「Create」按钮）；④ 分隔线下「Workspaces in group: 演示 2」区，列出全部 workspace——dsh-one ✓、dsh-web research ✓（都在演示组）两项勾选；弹层外主列表仍可见（半透明遮罩盖住）。',
    },

    'sessions-groups-manage-rename': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `(() => {
        document.querySelector('.ws-group-select')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Manage groups'))?.click()
        const row = document.querySelector('.wsg-row[data-group-id="g-dev"]')
        row?.querySelector('[aria-label="Rename group"]')?.click()
        const input = row?.querySelector('.wsg-row-rename-input')
        if (input) { input.value = '开发中'; input.dispatchEvent(new Event('input', { bubbles: true })) }
      })()`,
      title: '侧栏面板（管理分组：行内重命名编辑态）',
      expect: '管理视图中「开发」行进入重命名编辑态：组名替换为输入框（prefill「开发」，光标/选区在名上）；计数角标保留；行尾 ✎/🗑 仍在；行输入框无其他按钮（Enter 确认、Esc 取消；快照未回传时保持输入态）。',
    },

    'sessions-groups-purge': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        s.activeGroupId = null
        return s
      })(),
      interact: `(() => {
        document.querySelector('.ws-group-select')?.click()
        const items = [...document.querySelectorAll('.menu-item')]
        items.find((i) => i.textContent?.includes('Manage groups'))?.click()
        document.querySelector('.wsg-row[data-group-id="g-daily"] [aria-label="Delete group"]')?.click()
      })()`,
      title: '侧栏面板（管理分组：删除确认态）',
      expect: '「日常」行进入删除确认态：组名位置替换为「Delete group "日常"?」+ 「Delete」primary +「Cancel」secondary 按钮；✎/🗑 按钮消失（确认态下不显示）；其余组行不受影响。',
    },

    'sessions-groups-create-popover': {
      view: 'sessions',
      sessions: (() => {
        const s = window.sessionsTree('sess-4')
        Object.assign(s, window.SESSION_GROUPS_FIXTURE)
        return s
      })(),
      interact: `document.querySelector('.ws-group-add')?.click()`,
      title: '侧栏面板（「+」快速建组弹层）',
      expect: '点击分组栏右侧「+」弹出小浮层：标题「New group」+ 名称输入框（placeholder「Group name」+「Create」按钮）；浮层定位在「+」按钮下方；主列表没变化。',
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
    // ---- skill / cordis 专用工具卡（specialized-tool-cards）----

    // skill 卡完成态：行首 skill 图标 + 「Skill」+ 分隔点 + skill 名，可展开出
    // 「说明」指令全文卡（result 输出即指令全文）。
    'tool-skill': {
      state: base({
        messages: [
          u('帮我加载 worktree-dev-flow 技能。'),
          at('已加载，指令如下。', [
            toolBlock({
              name: 'skill',
              title: 'Load skill worktree-dev-flow',
              detail: undefined,
              args: JSON.stringify({ name: 'worktree-dev-flow', cwd: '/Users/cgeng/Workspaces/dsh-one' }),
              output: '# Worktree 并行开发流程\n\n## 核心规则\n\n- 主线（main）不开发任何东西，只负责测试、集成和合入。\n- 每个任务一个 worktree：`.worktrees/<slug>`，分支 `agent/<slug>`，独立装依赖。\n- worktree 里高频小提交，commit message 写清每步做了什么。',
            }),
          ]),
        ],
      }),
      title: 'skill 专用卡（完成态，可展开指令）',
      interact: `document.querySelector('.tool-skill details summary')?.click()`,
      expect: '助手消息里一条 skill 专用工具卡：行首 skill 文档图标（非通用工具图标）、动作短语「Skill」、分隔点、摘要为 skill 名「worktree-dev-flow」（普通灰字，非错误红）；点击展开后出现「说明」指令卡：带边框圆角块，头一行小字「说明」，下面 pre 展示指令全文（max-height 260 内滚动）；不再出现通用工具卡的「Ran a command」动作短语。',
    },

    // skill 卡运行态：无输出 → 不可展开，行首 spinner。
    'tool-skill-running': {
      state: base({
        messages: [
          u('加载 skill 中。'),
          at('', [
            toolBlock({
              name: 'skill',
              status: 'running',
              title: 'Load skill worktree-dev-flow',
              detail: undefined,
              args: JSON.stringify({ name: 'worktree-dev-flow' }),
              output: undefined,
            }),
          ]),
        ],
      }),
      title: 'skill 专用卡（运行态，不可展开）',
      expect: 'skill 卡运行态：行首是 spinner（旋转加载圈，非 skill 图标），动作短语「Skill」+ 分隔点 + skill 名「worktree-dev-flow」；**没有** chevron、**没有**「说明」指令卡（running 无输出不可展开）。',
    },

    // skill 卡失败态：行首红点，摘要为输出首行红字。
    'tool-skill-error': {
      state: base({
        messages: [
          u('加载一个不存在的 skill。'),
          at('加载失败了。', [
            toolBlock({
              name: 'skill',
              status: 'error',
              title: 'Load skill nope',
              detail: undefined,
              args: JSON.stringify({ name: 'nope' }),
              output: 'skill "nope" is unknown or no longer available\n更多堆栈',
            }),
          ]),
        ],
      }),
      title: 'skill 专用卡（失败态，红字摘要）',
      expect: 'skill 卡失败态：行首红色 StateDot（error 圆点，非 skill 图标），动作短语「Skill」+ 分隔点 + 摘要为输出首行「skill "nope" is unknown or no longer available」（红色错误字色）；可展开（有输出），展开后「说明」卡里 pre 展示全文。',
    },

    // cordis_define 卡：行首代码图标 + 「注册 Cordis 插件」+ 插件名 + 用途（灰字），
    // 可展开出 Host/Client 源码两段 + 结果段。
    'tool-cordis-define': {
      state: base({
        messages: [
          u('帮我注册一个测试插件。'),
          at('已注册。', [
            toolBlock({
              name: 'cordis_define',
              title: 'cordis_define',
              detail: undefined,
              args: JSON.stringify({
                name: 'demo-plugin',
                purpose: '演示用 Cordis 插件',
                code: { host: 'module.exports = { name: "demo" }', client: 'export default {}' },
              }),
              meta: { pluginId: 'demo', packageId: 'pkg-1' },
              output: 'defined ok: pluginId=demo packageId=pkg-1',
            }),
          ]),
        ],
      }),
      title: 'cordis_define 专用卡（源码展开）',
      interact: `document.querySelector('.tool-cordis-define details summary')?.click()`,
      expect: '助手消息里一条 cordis_define 专用卡：行首代码图标（尖括号 `</>`，非通用工具图标）、动作短语「注册 Cordis 插件」、分隔点、摘要为插件名「demo-plugin」（普通灰字）、尾部用途「演示用 Cordis 插件」（更淡的灰字，与插件名区分）；点击展开后出现两段源码：label「Host」+ host 代码、label「Client」+ client 代码（等宽 pre，max-height 260 内滚动），再一段「结果」+ 输出文本。',
    },

    // cordis_run 卡：无展开，输出直接平铺在行下。
    'tool-cordis-run': {
      state: base({
        messages: [
          u('运行一下 demo 插件。'),
          at('已运行。', [
            toolBlock({
              name: 'cordis_run',
              title: 'cordis_run',
              detail: undefined,
              args: JSON.stringify({ pluginId: 'demo', packageId: 'pkg-1', mode: 'run' }),
              meta: { pluginId: 'demo', packageId: 'pkg-1', pluginRunId: 'run-42' },
              output: 'activated ok',
            }),
          ]),
        ],
      }),
      title: 'cordis_run 专用卡（输出平铺）',
      expect: '助手消息里一条 cordis_run 专用卡：行首代码图标、动作短语「运行 Cordis 插件」、分隔点、摘要为「demo · pkg-1」（pluginId · packageId 点连接）；**没有** chevron/展开（run 卡不是 disclosure），行下直接平铺输出文本「activated ok」。',
    },

    // cordis_stop / cordis_undefine 卡：stop 方块 / 垃圾桶图标。
    'tool-cordis-actions': {
      state: base({
        messages: [
          u('停止并移除 demo 插件。'),
          at('已处理。', [
            toolBlock({
              name: 'cordis_stop',
              title: 'cordis_stop',
              detail: undefined,
              args: JSON.stringify({ pluginId: 'demo' }),
              output: 'stopped',
            }),
            toolBlock({
              name: 'cordis_undefine',
              title: 'cordis_undefine',
              detail: undefined,
              args: JSON.stringify({ pluginId: 'demo' }),
              output: 'removed',
            }),
          ]),
        ],
      }),
      title: 'cordis_stop / cordis_undefine 专用卡',
      expect: '助手消息里两条 cordis 动作卡：第一条行首 stop 方块图标、动作短语「停止 Cordis 插件」、分隔点、摘要「demo」，行下平铺输出「stopped」；第二条行首垃圾桶图标、动作短语「移除 Cordis 插件」、分隔点、摘要「demo」，行下平铺输出「removed」；两条都无 chevron（非 disclosure）。',
    },

    // 产物行（ProducedFiles 对齐）：>6 个文件折叠成「+N 个文件」，折叠态默认。
    'produced-files': {
      state: base({
        messages: [
          u('生成一批示例文件。'),
          {
            kind: 'assistant', id: 'a-pf-1', complete: true, turnEnd: true,
            blocks: [{ type: 'text', text: '已生成 8 个示例文件。' }],
            producedFiles: [
              '/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/c.ts', '/repo/src/d.ts',
              '/repo/src/e.ts', '/repo/src/f.ts', '/repo/src/g.ts', '/repo/src/h.ts',
            ],
          },
        ],
      }),
      title: '产物行（>6 个折叠）',
      expect: 'assistant 消息尾部（操作栏之前）出现「产物」行：label「产物」+ 恰好 6 个文件 chip（a.ts…f.ts，basename、悬停 title 为完整路径）+「+ 2 个文件」计数；无「在 VSCode 中打开」按钮；操作栏（复制/反馈/分叉）在产物行下方。',
    },

    // 点击「+N 个文件」→ 展开全部 chip（click 触发 render() 立即重画）。
    'produced-files-expanded': {
      state: base({
        messages: [
          u('生成一批示例文件。'),
          {
            kind: 'assistant', id: 'a-pf-2', complete: true, turnEnd: true,
            blocks: [{ type: 'text', text: '已生成 8 个示例文件。' }],
            producedFiles: [
              '/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/c.ts', '/repo/src/d.ts',
              '/repo/src/e.ts', '/repo/src/f.ts', '/repo/src/g.ts', '/repo/src/h.ts',
            ],
          },
        ],
      }),
      title: '产物行（点「+N 个文件」展开全部）',
      interact: `document.querySelector('.produced-more')?.click()`,
      expect: '点击「+ 2 个文件」后**立即**展开：8 个文件 chip 全部可见（a.ts…h.ts），计数文案变为「收起」；再点「收起」恢复 6 chip +「+ 2 个文件」。',
    },

    // 文件多且名字长（用户反馈：单行 nowrap 截断）→ 展开后换行铺开。
    'produced-files-wrap': {
      state: base({
        messages: [
          u('把重构涉及的源文件都改一遍。'),
          {
            kind: 'assistant', id: 'a-pf-3', complete: true, turnEnd: true,
            blocks: [{ type: 'text', text: '已改 14 个文件。' }],
            producedFiles: [
              '/repo/src/packages/conversation/folder/folding-state.ts',
              '/repo/src/packages/conversation/folder/produced-products.ts',
              '/repo/src/packages/conversation/turn-tail/rendering-hooks.ts',
              '/repo/src/packages/conversation/turn-tail/produced-files-row.ts',
              '/repo/src/packages/chat/webview/render-message.ts',
              '/repo/src/packages/chat/webview/render-block.ts',
              '/repo/src/packages/chat/webview/render-tools.ts',
              '/repo/src/packages/chat/webview/render-actions.ts',
              '/repo/src/packages/chat/webview/scroll-follow.ts',
              '/repo/src/packages/chat/webview/queue-editor.ts',
              '/repo/src/packages/chat/chatViewProvider.ts',
              '/repo/src/packages/chat/chatSessionController.ts',
              '/repo/src/packages/pure/chatContract.ts',
              '/repo/src/packages/pure/producedFiles.ts',
            ],
          },
        ],
      }),
      title: '产物行（长文件名多文件换行）',
      interact: `document.querySelector('.produced-more')?.click()`,
      expect: '点击「+ N 个文件」展开后：14 个长文件名 chip **多行换行铺开**（行尾不截断、不裁掉 chip），每行 label「产物」左侧只出现一次且与首行对齐；每个 chip 内超宽文件名以省略号截断、悬停 title 为完整路径；「收起」在最后一个 chip 后。',
    },

    // 消息右键菜单（user 气泡）：右键弹「复制」坐标菜单（与既有外链菜单同款
    // popover），复制纯文本。interact 先把图片字节喂进懒取缓存（缩略图上屏
    // 等效宿主回执），再在气泡上派发 contextmenu 打开菜单截图。
    'msg-menu-user': {
      png: PNG_RED,
      state: base({
        messages: [
          {
            kind: 'user', id: 'u-copy',
            text: '看下这张截图和源码，然后回复。',
            images: [{ attachmentId: 'att-1', mediaType: 'image/png', name: 'chart.png' }],
            files: [
              { name: 'img1.png', path: '/Users/a/dsh-one/dsh-attachments/img1.png', image: true },
              { name: 'note.md', path: '/Users/a/dsh-one/dsh-attachments/note.md' },
            ],
          },
          at('收到，我先看截图和附带的源码。'),
        ],
      }),
      interact: `(() => {
        const s = window.SCENARIOS['msg-menu-user']
        window.postMessage({ type: 'attachmentData', attachmentId: 'att-1', mediaType: 'image/png', data: s.png }, '*')
        window.postMessage({ type: 'fileThumb', path: '/Users/a/dsh-one/dsh-attachments/img1.png', mediaType: 'image/png', data: s.png }, '*')
        setTimeout(() => {
          document.querySelector('.msg.user')?.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 220 }),
          )
        }, 150)
      })()`,
      title: '用户消息右键菜单：复制（纯文本）',
      expect: '用户消息区域出现坐标定位的右键菜单（popover，深色圆角、贴近右击点、钳制在视口内）：一项「Copy」，带左侧复制图标；菜单与消息气泡同时可见。消息附件区（气泡上方）：chart.png 与 img1.png 两张红色 48px 缩略图（底部名称横幅）、note.md 文档图标文件 chip；气泡正文只有「看下这张截图和源码，然后回复。」——复制针对纯文本，附件不进剪贴板。',
    },

    // 消息右键菜单（assistant 气泡）：producedFiles 消息右键同样只弹「复制」。
    'msg-menu-assistant': {
      state: base({
        messages: [
          u('帮我改下界面，出个截图。'),
          {
            kind: 'assistant', id: 'a-copy', complete: true, turnEnd: true,
            blocks: [{ type: 'text', text: '已改好，产出截图和说明。' }],
            producedFiles: ['/Users/a/dsh-one/out/shot-1.png', '/Users/a/dsh-one/out/notes.md'],
          },
        ],
      }),
      interact: `(() => {
        setTimeout(() => {
          document.querySelector('.msg.assistant')?.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 280 }),
          )
        }, 150)
      })()`,
      title: '助手消息右键菜单：复制（producedFiles 消息只复制正文）',
      expect: 'assistant 消息区域出现的右键菜单只有一项「Copy」（带复制图标）；消息尾部「产物」行两个 chip：shot-1.png、notes.md；操作栏（复制/反馈/分叉）在产物行下方。',
    },
    'turn-status-notices': {
      state: base({
        messages: [
          u('帮我重构这个模块。'),
          // 超 token 提示：assistant 消息尾部黄色 warning 行。
          {
            kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, maxTokens: true,
            blocks: [{ type: 'text', text: '这个模块的改动涉及以下文件…（回答在此被截断）' }],
          },
          // 重试行：scheduled 等待态（倒计时）+ started 终态各一条。
          {
            kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
            blocks: [
              { type: 'text', text: '先执行测试确认基线。' },
              {
                type: 'retry', retry: 1, mode: 'normal', maxRetries: 3, delayMs: 12000,
                failure: { message: 'rate limited (429), retry after 12s' }, retryState: 'scheduled', time: Date.now(),
              },
            ],
          },
          {
            kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
            blocks: [
              { type: 'text', text: '模型请求失败后自动恢复。' },
              {
                type: 'retry', retry: 2, mode: 'normal', maxRetries: 3, delayMs: 5000,
                failure: { message: 'upstream timeout' }, retryState: 'started', time: Date.now() - 60000,
              },
            ],
          },
        ],
      }),
      title: '流内状态提示行：超 token / 重试行',
      expect: '消息流里依次出现三条状态行：① maxTokens 助手消息尾部有一行黄色提示（warning 圆点 + 加粗「已达到输出 token 上限」+ 灰色 hint「回答被截断，已有输出保留在对话中…」）；② scheduled 重试行是带扫光动画的灰色小字行「正在重试模型请求（1/3） · Ns」（N 在 1–12 之间，倒计时）且可展开（details chevron），展开显示「重试延迟：12000ms / 失败原因：rate limited…」；③ started 重试行静态显示「已重试模型请求（2/3） · 5s」。三条行都只占一行、不破坏消息气泡布局；操作栏（复制/反馈/分叉）只在 turnEnd 消息上出现。',
    },

    'compaction-cards': {
      state: base({
        messages: [
          u('这个对话已经很长了，压缩一下。'),
          // 自动压缩独立卡：计数 + 摘要，默认折叠可展开。
          {
            kind: 'compaction', id: 'c-auto-1',
            summary: '前文要点：用户要求重构 chat 模块，已完成调研、拆分方案与两轮实现，当前在验证阶段。',
            items: 42, tokens: 12340,
          },
          // 手动 /compact：checkpoint 合并进命令卡（带计数摘要）。
          {
            kind: 'command', id: 'cmd-1', name: 'compact', status: 'success',
            text: 'Compacted 42 history items (~12340 tokens).',
            compaction: { summary: '前文要点：压缩前的对话围绕工作流编排展开，已确认方案并进入实现。', items: 42, tokens: 12340 },
          },
          u('继续。'),
          // 窗口外丢 summary 的退化态：不可展开的纯展示行。
          { kind: 'compaction', id: 'c-auto-2', summary: null, items: null, tokens: null },
        ],
      }),
      title: '压缩摘要卡（独立卡 / 命令卡合并 / 不可展开）',
      expect: '消息流里出现三张压缩行：① 独立压缩卡（标题「上下文已压缩」+ 分隔点 + 摘要「已压缩 42 条历史记录（约 12340 tokens）」，行首 chevron 向右、整行可点展开摘要全文 markdown）；② 手动 /compact 卡同样形态但标题是「/compact」；③ 无摘要的退化卡是纯展示行（无 chevron、无点击态，摘要文字「压缩摘要不可用」）。三行都不渲染成用户气泡、不出现 checkpoint 原文。',
    },
    'attachment-uniform': {
      state: base({
        messages: [
          {
            kind: 'user', id: rid('u'), text: '看看这两个附件。',
            images: [{ attachmentId: 'img-1', mediaType: 'image/png', name: 'chart.png' }],
            files: [{ name: 'README.md', path: '/Users/cgeng/Workspaces/dsh-one/README.md' }],
          },
          at('好的，图片和文件都看到了。'),
        ],
      }),
      title: '附件框尺寸统一（输入区 + 已发送消息）',
      expect: '已发送的用户消息气泡上方一行两个同尺寸方块：左边图片缩略图（红色实心图），右边文件框（文档图标在上、README.md 在下）；两框同宽同高、圆角一致、垂直对齐。输入区上方同样一行两个同尺寸方块：图片缩略图 + 文件框（README.md），与消息区的两框尺寸一致。文件框内文字不溢出框外（过长 ellipsis）。不应再出现横向长条 pill 形状的文件 chip。',
      interact: `postMessage({ type:'attachmentData', attachmentId:'img-1', mediaType:'image/png', data:'${PNG_RED}' }, '*');
postMessage({ type:'filesPicked', files:[{ name:'photo.png', path:'/tmp/dsh-one-attachments/u-1/photo.png', image:true, mediaType:'image/png', previewData:'${PNG_RED}' }] }, '*');
postMessage({ type:'filesPicked', files:[{ name:'README.md', path:'/Users/cgeng/Workspaces/dsh-one/README.md' }] }, '*');`,
    },

    // ---- 一键清空按钮（本地增强 composer-clear-all-button）----
    'composer-clear-all': {
      state: base({}),
      title: '一键清空按钮（文本 + 附件时可见）',
      interact: `(() => {
        const post = (m) => window.postMessage(m, '*')
        const ta = document.getElementById('input')
        if (ta) {
          ta.value = '把这段草稿和附件一起清空'
          ta.dispatchEvent(new Event('input'))
        }
        post({ type: 'filesPicked', files: [{ name: 'photo.png', path: '/tmp/dsh-one-attachments/u-1/photo.png', image: true, mediaType: 'image/png', previewData: '${PNG_RED}' }, { name: 'notes.md', path: '/tmp/notes.md' }] }, '*')
      })()`,
      expect: '输入框右侧、发送按钮左侧出现 ghost × 按钮（20px，灰色小字，无底色）；输入框高亮层绘制「把这段草稿和附件一起清空」；输入区上方 chips 行：红色图片缩略图 + 文件框（notes.md）——× 与 chip 自带 ×（chips 各自右上角）不在同一位置，无重叠；本轮只验证「有内容时 × 可见」的散布与排版。',
    },
    'composer-clear-all-click': {
      state: base({}),
      title: '点击一键清空：文本/附件全清，焦点回输入框',
      interact: `(() => {
        const post = (m) => window.postMessage(m, '*')
        const ta = document.getElementById('input')
        if (!ta) return
        ta.value = '这段文本会被 × 清空'
        ta.dispatchEvent(new Event('input'))
        post({ type: 'filesPicked', files: [{ name: 'photo.png', path: '/tmp/dsh-one-attachments/u-1/photo.png', image: true, mediaType: 'image/png', previewData: '${PNG_RED}' }] }, '*')
        // 附件回执触发 render 后 × 才可见：用 MutationObserver 等它上屏再点
        // （不用固定 setTimeout：后台 tab 定时器被浏览器节流）。
        const root = document.getElementById('app')
        const onBtn = new MutationObserver(() => {
          const btn = document.querySelector('.clear-all-button')
          if (!btn || btn.hidden) return
          onBtn.disconnect()
          btn.click()
          // click 处理器内 render() 同步重建 composer，随后记录断言结果
          const input = document.getElementById('input')
          window.__clearAllCheck = {
            value: input ? input.value : null,
            focused: input ? document.activeElement === input : false,
            buttonHidden: document.querySelector('.clear-all-button')?.hidden ?? null,
          }
          document.title = 'CLEARED:' + JSON.stringify(window.__clearAllCheck)
        })
        onBtn.observe(root, { childList: true, subtree: true })
      })()`,
      expect: '点击 × 后：输入框为空（高亮层无文本、无占位残影）、图片 chips 行消失、× 隐藏（内容清空后不再是 dirty 态）、输入框拿到焦点（focus outline）。',
    },

  }

  catalog.conversation.sessions = window.sessionsTree('sess-1')

  // 消息级计时（turn 尾部操作栏行尾，对齐官方 TurnTailNodeView）。
  catalog['message-timing'] = {
    state: base({
      messages: [
        u('这个任务花了多久？'),
        {
          kind: 'assistant',
          id: rid('a'),
          complete: true,
          turnEnd: true,
          seq: 42,
          blocks: [{ type: 'text', text: '整体两分多钟完成，主要耗时在工具调用。' }],
          // 全指标：用时 2m42s、ttft 1.2s、95 tok/s
          timing: { time: Date.now() - 5 * 60_000, runMs: 162_000, ttftMs: 1200, tokensPerSecond: 95 },
        },
        {
          kind: 'assistant',
          id: rid('a'),
          complete: true,
          turnEnd: true,
          seq: 84,
          blocks: [{ type: 'text', text: '补充说明：过程中有两次重试。' }],
          // 缺省形态：runMs/ttft 有，tps 无（usage 缺失时）；一位小数 tps 在第一条验证
          timing: { time: Date.now() - 60_000, runMs: 42_000, ttftMs: 350 },
        },
      ],
    }),
    title: '消息级计时（操作栏行尾）',
    expect: '两条助手消息的操作栏（复制/👍/👎/分支图标）行尾出现计时文本：第一条「HH:MM · 用时 2分42秒 · 首 token 1.2秒 · 95 tok/s」，第二条「HH:MM · 用时 42秒 · 首 token 0.4秒」（第二条无 tok/s——usage 缺失不显示）；计时为次级灰色小字、nowrap 单行、与图标垂直居中、用 · 分隔；用户消息与未完成消息没有计时；分叉按钮仍在（seq 存在且未中断）。',
  }

  // 上下文注入：6 种 form 的结构化 body（worktree 验收用，改完 UI 后对照下方
  // expect 核对；点击/展开由 interact 自动打开所有 context 折叠卡）。
  catalog['context-injection-forms'] = {
    state: base({
      messages: [
        u('你把这个仓库的上下文注入改成结构化 body。'),
        { kind: 'user', id: rid('u'), text: '## Instructions\n工作区指令注入…', context: { kind: 'agent-instructions', form: 'instructions', baseline: 'root', changes: [
          { path: 'AGENTS.md', action: 'set', digest: 'abc123' },
          { path: 'notes/dev.md', action: 'replace' },
          { path: 'stale.md', action: 'remove' },
        ] } },
        { kind: 'user', id: rid('u'), text: '## Catalog\n插件能力目录…', context: { kind: 'plugin', form: 'catalog', update: true, entries: [
          { name: 'review', description: '代码评审助手' },
          { name: 'search', description: '仓库语义搜索' },
        ] } },
        { kind: 'user', id: rid('u'), text: '## Snapshot\n当前状态快照…', context: { kind: 'plugin', form: 'snapshot', sections: [
          { name: '任务', text: '上下文注入结构化 body 进行中' },
          { name: '文件', text: 'src/pure/conversation.ts\nsrc/pure/chatContract.ts\nsrc/ui/chat/webview.ts' },
        ] } },
        { kind: 'user', id: rid('u'), text: '后台任务已完成。', context: { kind: 'plugin', form: 'notice', summary: '后台子代理完成通知' } },
        { kind: 'user', id: rid('u'), text: '来自另一个 agent 的转发消息正文。', context: { kind: 'plugin', form: 'relay', senderSessionId: 'sess-9' } },
        { kind: 'user', id: rid('u'), text: '## Referenced sessions\n跨会话召回…', context: { kind: 'session-reference', form: 'recall', references: [
          { label: '会话甲', retainedMessages: 3, omittedMessages: 2, truncated: true },
          { label: '会话乙', retainedMessages: 5, omittedMessages: 0 },
        ] } },
        { kind: 'user', id: rid('u'), text: '## Unknown\n未知形态…', context: { kind: 'plugin', form: 'mystery' } },
        at('已按 6 种 form 渲染完成。'),
      ],
    }),
    interact: `document.querySelectorAll('.msg.context').forEach((d) => { d.open = true })`,
    title: '上下文注入：6 种 form 结构化 body',
    expect: '逐条带「（已随消息注入）」折叠卡的上下文（可展开，展开后 body 在 141px 内滚动）：① 工作区指令（instructions）→ [set/replace/remove] 文件变更列表（等宽字体），下方保留注入正文；② Runtime context（catalog）→ 顶部「目录已替换」提示 + 能力目录 entries（名称粗体 + 描述），下方保留正文；③ Runtime context（snapshot）→ 顶部「本快照取代先前版本」说明 + 分段（name 标题 + 正文）；④ Runtime context（notice）→ 折叠行 summary 追加「后台子代理完成通知」，展开后仅正文；⑤ Runtime context（relay）→「来自会话 sess-9」一行 + 正文；⑥ 跨会话召回（recall，行首 ReferenceIcon 聊天气泡图标）→ 每个召回会话「label · 保留 X / 省略 Y」+「已截断」标记 + 正文；⑦ 未知 form（mystery）→ 退化为纯正文（无结构化列表）。所有折叠卡行首图标：recall 用聊天气泡，其余用浏览图标；折叠头正文不换行溢出。',
  }

  catalog['turn-usage-detail'] = {
    state: base({
      messages: [
        u('帮我看看这里有没有内存泄漏。'),
        {
          kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
          blocks: [{ type: 'text', text: '检查了 EventEmitter 的 dispose 路径：reload 断线重连时旧订阅未移除，会累积 listener。' }],
          timing: {
            time: Date.now(), runMs: 162000, ttftMs: 1200, tokensPerSecond: 45.2,
          },
          // 精确聚合：1048+512+96+1234 = 2890；缓存命中 512/1656 ≈ 30.9%。
          usage: {
            uncachedInputTokens: 1048,
            outputTokens: 1234,
            totalTokens: 2890,
            cacheReadTokens: 512,
            cacheWriteTokens: 96,
            reasoningTokens: 432,
            routes: [
              { provider: 'deepseek', model: 'deepseek-v4-flash' },
              { provider: 'deepseek', model: 'deepseek-chat' },
            ],
          },
        },
        u('那怎么修复？'),
        // 第二条已结束回答没有可证明的用量（缺边界语义）：不渲染药丸。
        {
          kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
          blocks: [{ type: 'text', text: '在 dispose() 里先移除订阅再释放 emitter，并给重连路径加复用标志。' }],
          timing: { time: Date.now(), runMs: 90000 },
        },
      ],
    }),
    interact: `document.querySelector('.msg-actions .msg-usage-pill').click()`,
    title: 'token 用量明细：药丸 + 锚定弹窗',
    expect: '第一条已结束回答的操作栏尾部分别显示：计时行（用时 2分42秒 · 首 token 1.2秒 · 45 tok/s 等）、用量药丸「Usage 2.9K」；点击药丸后锚定小窗在药丸上方展开：标题「Turn usage」+ 精确总量 2,890；分隔线下四行明细：Provider / model → deepseek/deepseek-v4-flash, deepseek/deepseek-chat；Cache hit → 30.9%；Uncached input → 1,048；Cached input → 512；Cache write → 96；Output → 1,234（其中推理 432，灰字小号）。第二条回答（无可证明用量）无药丸，只有计时行。outside 点击/ Esc 关闭弹窗。',
  }

  catalog['turn-usage-no-buckets'] = {
    state: base({
      messages: [
        u('只用输出计数一条样本。'),
        {
          kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
          blocks: [{ type: 'text', text: '这类样本没有输入/缓存计数，官方语义下无法证明，药丸不出现。' }],
          timing: { time: Date.now(), runMs: 5000 },
        },
      ],
    }),
    title: 'token 用量明细：缺计数不显示药丸（缺省语义）',
    expect: '已结束回答的操作栏只有计时行（时钟 + 用时 5秒），没有「Usage」药丸；无任何弹窗触发入口。',
  }

  // ---- 回合导航（轨道栏）场景 ----

  catalog['turn-navigator'] = {
    state: base({
      hasEarlierHistory: true,
      // 窗口只载入最后 3 个回合（turn 9-11）；turn 0-8 在窗口外（轨道栏仍显示）。
      messages: (() => {
        const msgs = []
        for (let k = 9; k <= 11; k += 1) {
          msgs.push({ kind: 'user', id: rid('u'), text: `第 ${k + 1} 个问题：继续推进。`, seq: 100 + k * 100 + 1 })
          msgs.push({
            kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, seq: 100 + k * 100 + 99,
            blocks: [{ type: 'text', text: `第 ${k + 1} 轮回答：已经推进完了。` }],
          })
        }
        return msgs
      })(),
      // 整份日志 12 个回合的 outline（投影侧预览已裁剪）。
      turnOutline: Array.from({ length: 12 }, (_, k) => ({
        turn: k,
        seq: 100 + k * 100,
        prompt: `第 ${k + 1} 个问题：继续推进。`,
        response: `第 ${k + 1} 轮回答：已经推进完了。这次改动覆盖了渲染与交互两条路径，剩余部分明天收尾。`,
      })),
    }),
    title: '回合导航：竖直轨道栏（已载入/未载入同显）',
    expect: '消息流右上角出现竖直轨道栏：12 条刻度（间距 10px），turn 0-8 未载入（半透明、较短），turn 9-11 已载入（实心），最新回合（turn 11）高亮蓝色；轨道栏悬浮于消息流上方（不占滚动流）；消息流顶部同时保留「Load earlier」按钮（hasEarlierHistory）。hover 任一刻度左侧弹出 preview 气泡（prompt 粗体一行 + response 三行省略裁剪）。',
  }

  catalog['turn-navigator-preview'] = {
    state: base({
      hasEarlierHistory: true,
      messages: [
        { kind: 'user', id: rid('u'), text: '第 10 个问题：继续推进。', seq: 1001 },
        { kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, seq: 1099, blocks: [{ type: 'text', text: '第 10 轮回答：已经推进完了。' }] },
        { kind: 'user', id: rid('u'), text: '第 11 个问题：收尾。', seq: 1101 },
        { kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, seq: 1199, blocks: [{ type: 'text', text: '第 11 轮回答：收尾完成。' }] },
      ],
      turnOutline: [
        { turn: 0, seq: 100, prompt: '第 1 个问题：开始。', response: '第 1 轮回答：开始做了。' },
        { turn: 1, seq: 200, prompt: '第 2 个问题：继续。', response: '第 2 轮回答：继续做了。' },
        { turn: 9, seq: 1000, prompt: '第 10 个问题：继续推进。', response: '第 10 轮回答：已经推进完了。' },
        { turn: 10, seq: 1100, prompt: '第 11 个问题：收尾。', response: '第 11 轮回答：收尾完成。' },
      ],
    }),
    interact: `document.querySelectorAll('.turn-rail-mark')[1].dispatchEvent(new MouseEvent('mouseenter'))`,
    title: '回合导航：hover preview 气泡',
    expect: '轨道栏 4 条刻度；hover 第 2 条（turn 1，未载入回合）时其左侧弹出 preview 气泡：首行粗体「第 2 个问题：继续。」（prompt，一行），下一行灰色小字「第 2 轮回答：继续做了。」（response，最多三行）；其他刻度无气泡；气泡带圆角卡片底+投影。',
  }

  catalog['turn-navigator-jump'] = {
    state: base({
      hasEarlierHistory: true,
      messages: [
        { kind: 'user', id: rid('u'), text: '第 11 个问题：收尾。', seq: 1101 },
        { kind: 'assistant', id: rid('a'), complete: true, turnEnd: true, seq: 1199, blocks: [{ type: 'text', text: '第 11 轮回答：收尾完成。' }] },
      ],
      turnOutline: [
        { turn: 0, seq: 100, prompt: '第 1 个问题：开始。', response: '第 1 轮回答：开始做了。' },
        { turn: 1, seq: 200, prompt: '第 2 个问题：继续。', response: '第 2 轮回答：继续做了。' },
        { turn: 2, seq: 300, prompt: '第 3 个问题：再继续。', response: '第 3 轮回答：再继续做了。' },
        { turn: 10, seq: 1100, prompt: '第 11 个问题：收尾。', response: '第 11 轮回答：收尾完成。' },
      ],
    }),
    interact: `document.querySelectorAll('.turn-rail-mark')[1].click()`,
    title: '回合导航：点击未载入回合发布跳转',
    expect: '点击 turn 1（未载入）刻度无报错；host 收到 turnJump（seq=200）（__posted 断言）；轨道栏与消息流保持原样（harness mock 无宿主响应）。',
  }

  // ---- 阶段 4：字号调节 + 定时计划 chip ----

  /** 字号场景共用的消息流：markdown 表格 + 思考块 + 正文，检查内容区联动。 */
  function fontState(over) {
    return base({
      messages: [
        u('把本次改造的方案整理成表格，并给出思考过程。'),
        {
          kind: 'assistant', id: rid('a'), complete: true, turnEnd: true,
          blocks: [
            { type: 'reasoning', text: '先对齐官方变量链，再处理次级文字档位，最后把设置写进面板 HTML 防止首帧闪烁。' },
            { type: 'text', text: '## 方案要点\n\n| 改造项 | 做法 | 成本 |\n| --- | --- | --- |\n| 字号调节 | 设置 12-17px → CSS 变量链 | 低 |\n| 定时计划 | host 折叠 schedule 投影 | 低 |\n\n正文说明：**只调内容区**，头部与 composer 不动。' },
          ],
        },
      ],
      ...over,
    })
  }

  catalog['chat-font-size-default'] = {
    state: fontState({}),
    title: '字号：默认 14px（内容区 + 表格 + 思考块）',
    expect: '标题区与 composer 不变；消息内容区正文为默认字号（14px 级），markdown 表格/思考块为次级档（13px 级，比正文略小）；行内 code 等宽字体不动；面板布局与默认 baseline 一致。',
  }

  catalog['chat-font-size-large'] = {
    state: fontState({}),
    interact: `window.postMessage({ type: 'chatFontSize', value: 17 }, '*')`,
    title: '字号：运行中改为 17px（内容区联动）',
    expect: '上下文区正文明显大于默认档（17px 级）；表格与思考块为次级档（17 档 = 15px 级）随之放大；标题区 chips/composer 字号不变（面板 chrome 不随动）；行内 code/代码块保持等宽与既有比例。',
  }

  catalog['schedule-chip'] = {
    state: fontState({
      // 投影 wire 视图：活动提醒（overdue 在前 + scheduled every 一条）。
      schedule: [
        { id: 'sch-1', kind: 'at', prompt: '检查测试报告是否完成', scheduledAt: '2020-01-01T00:00:00.000Z' },
        { id: 'sch-2', kind: 'every', everySeconds: 3600, prompt: '每小时代码审查', scheduledAt: '2099-01-01T09:00:00.000Z' },
      ],
    }),
    interact: `(() => { const chip = [...document.querySelectorAll('button.header-chip')].find((c) => c.title === 'Active reminders'); if (chip) chip.click() })()`,
    title: '定时计划：AlarmClock chip + 只读下拉（scheduled/overdue）',
    expect: '标题区子代理/后台任务同排出现「2 reminders」chip（AlarmClock 图标 + 计数 + chevron）；点击弹只读下拉：2 行——逾期行在前（琥珀状态点 + Overdue + prompt + 元信息「Once · 本地时刻 · 2439 days overdue」），等待中行（蓝色状态点 + Scheduled + 「Every 1 hour」频率 + 剩余时间 in …days）；逾期行淡黄底。',
  }

  catalog['schedule-chip-closed'] = {
    state: fontState({
      schedule: [
        { id: 'sch-1', kind: 'at', prompt: '检查测试报告是否完成', scheduledAt: '2020-01-01T00:00:00.000Z' },
      ],
    }),
    title: '定时计划：chip 收起态（单一提醒）',
    expect: '标题区显示「1 个提醒」chip（AlarmClock + 计数 + chevron），菜单未开；无任何弹层残留。',
  }

  catalog['schedule-chip-live'] = {
    state: fontState({}),
    interact: `(() => {
      // 复现运行中追加（真 0.1.2 schedule 投影中途到达）：首帧无 schedule，
      // 300ms 后再推带 schedule 的 state——header 签名必须识别变化并重建出 chip。
      const s = window.SCENARIOS['schedule-chip-live'].state
      window.postMessage({ type: 'state', state: {
        ...s,
        schedule: [{ id: 'sch-9', kind: 'at', prompt: '追加提醒', scheduledAt: '2099-02-02T09:00:00.000Z' }],
      } }, '*')
    })()`,
    title: '定时计划：运行中投影到达（首帧无 → 后帧有，head 重建出 chip）',
    expect: '首帧渲染时标题区无提醒 chip；interact 后 state 带 schedule 到达，标题区重建出现「1 reminder」chip（AlarmClock + 计数 + chevron）——验证 header 签名包含 schedule（保活旧头部会吞掉新 chip）。',
  }

  catalog['schedule-chip-empty'] = {
    state: fontState({}),
    title: '定时计划：无计划（0.1.1 服务器降级 / 无活动提醒）',
    expect: '标题区无 AlarmClock chip、无提醒计数（state.schedule 缺省 = 0.1.1 服务器无该投影或暂无计划）；header 布局与其余 chips 正常，无报错。',
  }

  // 基线冒烟集：主线合入后跑这批稳定场景做回归（ui-visual.sh --mode baseline）。
  // 新增功能的场景先加进 window.SCENARIOS 做 worktree 验收；要让它成为"以后谁都不能弄坏"
  // 的存量状态，就把它的名字加进 BASELINE_SCENARIOS —— 随合入并入主线基线。
  window.SCENARIOS = catalog
  window.BASELINE_SCENARIOS = [
    'conversation', 'markdown', 'empty', 'dsh-not-found', 'approval', 'question',
    'plan-review', 'todos', 'subagents', 'history', 'model-picker', 'sessions',
    'sessions-search', 'sessions-collapsed', 'sessions-recycle-drawer',
    'sessions-workspace-menu-groups',
    'session-mention', 'mention-chips', 'workflow-running', 'workflow-finished', 'diff-side-by-side',
    'tool-skill', 'tool-skill-running', 'tool-skill-error',
    'tool-cordis-define', 'tool-cordis-run', 'tool-cordis-actions',
    'produced-files', 'produced-files-expanded', 'produced-files-wrap',
    'goal-active',
    'steering-pending',
    'composer-clear-after-send',
    'attachment-uniform',
  ]
  window.DEFAULT_SCENARIO = 'conversation'
})()
