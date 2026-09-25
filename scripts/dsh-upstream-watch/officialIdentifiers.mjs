/**
 * 官方内部标识符探针（#179）——对着**本机已安装的官方产物**逐个查存在性。
 *
 * ## 这里查的是什么、为什么要单列一类
 *
 * 这一族依赖的坏法都是**静默失效**：官方改了名字，我们这边不报错，只是那件事不再
 * 生效（提示不弹了、官方的件悄悄冒回界面、遮蔽目标对不上），日常使用看不出来。探针
 * 是发布前唯一能发现它们的手段，所以按「名字还在不在」挨个钉住。
 *
 * 与 `clientContract.mjs` 的分工：那边查的是**网关下发的 combo**（官方发给浏览器的
 * 产物，要起网关、走网络），这边查的是**本机已安装的官方包文件**（离线、只读磁盘，
 * 不依赖网关起不起得来）。同一个名字两边都查，是因为失效方式不同：combo 面现形于
 * 「网关产物的写法变了」，本机产物面现形于「装到本机的这版官方包内容变了」（含
 * combo 里根本没有的类型声明与清单文件）。
 *
 * ## 清单与出处
 *
 * 清单来自 #96 审计 comment 第七节「核实方法」的核实结果，基线 dsh **0.1.6-alpha.1**，
 * 逐条在本机 `~/.dsh/profiles/node_modules/@deepseek-ai/**` 上只读核对过。那里的条目
 * 都是**符号链接**（指向该版本 dsh 安装目录下的 `node_modules/@deepseek-ai`），所以调用方
 * 要先把 root 解析成真身再传进来。
 *
 * 每条依赖写明四件事：
 *
 * - `pkg` / `file`：标识符在该官方包里的**出处文件**（探针读的就是它）；
 * - `pattern`：**形状**（存在性检查，不比对内容）；写法容得下空格差异，官方换打包
 *   格式（如重新压缩）不会假红；
 * - `why`：漂移了会静默失效在什么地方（维护者读的文档，不进断言 detail）；
 * - `where`：我方取用点——名字没了，就是这里静默失效。
 *
 * 新增一条 = 在 `IDENTIFIERS` 里加一行（出处文件 + 形状 + 我方使用点），并在
 * `docs/dsh-compat-checklist.md` 的清单里登记。
 *
 * 另有一项不在 `IDENTIFIERS` 里：**我们取用的官方图标的导出名**（#236 立的表，#252 起 27 枚）。它查的不是
 * 某一个符号的形状，而是「两代名字里至少一个还在不在」——判据、为什么不读 combo 而读前端
 * 产物，写在 `checkOfficialIconExports` 的文件头上。
 */
import fs from 'node:fs'
import path from 'node:path'
import { OFFICIAL_ICON_NAMES, iconExportCandidates } from '../../src/pure/officialIcons.ts'

/**
 * 必须仍然存在的官方内部标识符。
 *
 * `id` 用 `<类别>.<名字>` 形式：报红时人一眼能看出是哪一族的哪个名字。
 */
export const IDENTIFIERS = [
  {
    id: 'root-children.sidebar',
    what: 'root 子槽声明表里的 sidebar 座（single / scope root）',
    pkg: '@deepseek-ai/dsh-client-ui-layout',
    file: 'lib/client.js',
    pattern: /"sidebar"\s*:\s*\{\s*kind:\s*"single"\s*,\s*scope:\s*"root"/,
    why: '官方 ui-layout 的 children 表是别的官方插件注册槽位的前置；我们复刻了这份声明表，漏一项或名字变了，挂在它下面的官方子树整块注册失败',
    where: 'src/ui/assembly/shell/frameShared.ts:19-38（复刻的声明表）、sidebarLayoutPlugin.ts:388-404',
  },
  {
    id: 'root-children.main',
    what: 'root 子槽声明表里的 main 座（keyed / scope root）',
    pkg: '@deepseek-ai/dsh-client-ui-layout',
    file: 'lib/client.js',
    pattern: /"main"\s*:\s*\{\s*kind:\s*"keyed"\s*,\s*scope:\s*"root"/,
    why: '会话面板座；0.1.6 起从 single `conversation` 换成 keyed `main`（key = 会话面板 id），改名或换 kind 会让会话区整块空掉',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:254-255（按 entryKey 渲染）、settingsLayoutPlugin.ts:351',
  },
  {
    id: 'root-children.rightbar',
    what: 'root 子槽声明表里的 rightbar 座（single / scope root）',
    pkg: '@deepseek-ai/dsh-client-ui-layout',
    file: 'lib/client.js',
    pattern: /"rightbar"\s*:\s*\{\s*kind:\s*"single"\s*,\s*scope:\s*"root"/,
    why: '右列座；不声明它，官方 ui-sidebar-right 就不注册自己的内容（#79 决策 B 的接入点）',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:8-15（children 声明 + 右栏列）',
  },
  {
    id: 'root-children.shell.overlay',
    what: 'root 子槽声明表里的 shell.overlay 座（list / scope root）',
    pkg: '@deepseek-ai/dsh-client-ui-layout',
    file: 'lib/client.js',
    pattern: /"shell\.overlay"\s*:\s*\{\s*kind:\s*"list"\s*,\s*scope:\s*"root"/,
    why: '全宽悬浮层；我们把它当自有浮层（右键菜单、git 卡片）的落点，官方换 kind 或改名后这些浮层不再渲染（不报错）',
    where: 'packages/dsh-context-menu/src/contextMenuPlugin.ts:308、packages/dsh-git-card/src/gitCardPlugin.ts:601',
  },
  {
    id: 'sidebar-toggle.zh',
    what: '官方侧栏折叠钮的中文无障碍文案（词典键 `toggle.collapse`）',
    pkg: '@deepseek-ai/dsh-client-ui-sidebar',
    file: 'lib/client.js',
    pattern: /"toggle\.collapse"\s*:\s*"收起侧边栏"/,
    why: '#178 C8 起我们不再按文案认这枚钮：它在 logoRow 里，logoRow 隐藏时它跟着隐藏（此前那两条按 aria-label 藏的规则从写下起就没生效过——中文词典原文是「收起侧边栏」）。这两条留作官方文案的记录，哪天要重新按文案认件时照着核对',
    where: 'src/ui/assembly/shell/sidebarLayoutPlugin.ts（`[class*="logoRow"]` 那条规则，也就是这两条文案如今不参与的地方）',
  },
  {
    id: 'sidebar-toggle.en',
    what: '官方侧栏折叠钮的英文无障碍文案（词典键 `toggle.collapse`）',
    pkg: '@deepseek-ai/dsh-client-ui-sidebar',
    file: 'lib/client.js',
    pattern: /"toggle\.collapse"\s*:\s*"Collapse sidebar"/,
    why: '同上（#178 C8 之后两条都不再参与认件）',
    where: 'src/ui/assembly/shell/sidebarLayoutPlugin.ts（同上）',
  },
  {
    id: 'entry-id.session-log-download',
    what: '官方会话日志导出条目在 `conversation.session.header.utilities` 上的 id',
    pkg: '@deepseek-ai/dsh-session-log-export',
    file: 'lib/client.js',
    pattern: /\bid:\s*"session-log-download"/,
    why: '我们按条目 id 遮蔽它、换成自有导出（按 id 是官方注册表的原生手段，比按 DOM 位置摘稳）；id 改了遮蔽落空，官方那枚按钮冒回会话头',
    where: 'packages/dsh-session-export/src/sessionExportPlugin.ts:101-103',
  },
  {
    id: 'entry-id.appearance',
    what: '官方设置「外观」行在 `settings.general.item` 上的 id',
    pkg: '@deepseek-ai/dsh-client-ui-theme',
    file: 'lib/client.js',
    pattern: /\bid:\s*"appearance"/,
    why: '我们按条目 id 遮蔽它（#178 C10+C11 起：同 id + priority −1 注册空件，官方那条仍在注册表里但不进渲染位）；id 改名会让遮蔽静默落空，官方外观行冒回设置页',
    where: 'src/ui/assembly/shell/settingsLayoutPlugin.ts（ctx.slots.register({ name: "settings.general.item", id: "appearance", priority: -1 }, Nothing)）',
  },
  {
    id: 'entry-id.open-document',
    what: '官方设置「打开配置文件」动作者在 `settings.action` 上的 id',
    pkg: '@deepseek-ai/dsh-client-ui-settings-general',
    file: 'lib/client.js',
    pattern: /\bid:\s*"open-document"/,
    why: '同上（#178 C10+C11 起按 id 遮蔽；我们自有那条的 id 是 open-document-vscode，走 VS Code 编辑器）',
    where: 'src/ui/assembly/shell/settingsLayoutPlugin.ts（ctx.slots.register({ name: "settings.action", id: "open-document", priority: -1 }, Nothing)）',
  },
  {
    id: 'entry-id.cordis-panel',
    what: '官方 cordis 面板在 `sidebar.footer.action` 上的条目 id',
    pkg: '@deepseek-ai/dsh-client-ui-cordis',
    file: 'lib/client.js',
    pattern: /\bid:\s*"cordis-panel"/,
    why: '我们往同一个 list 槽追加底部入口，排位是相对它算的（官方改 id 后「谁在前谁在后」的假设静默失效）',
    where: 'packages/dsh-workspace-tree/src/workspaceTreePlugin.ts:675-683（`ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-one-recycle-bin" })`）',
  },
  {
    id: 'snapshot-field.lastAgentError',
    what: '官方会话快照里的失败字段（"会话被另一个 dsh 占着写句柄"那条提示的判据）',
    pkg: '@deepseek-ai/dsh-api-session-controller',
    file: 'lib/client.js',
    pattern: /lastAgentError/,
    why:
      '我们读它判「这次打开失败在被占用的写句柄上」并飘提示（#183 起不再订阅内部事件名 api-session/error）；' +
      '它是官方 SessionSnapshot 契约里的一项、官方自己写进去，官方改字段名后那条提示静默消失（主流程不受影响）',
    where:
      'packages/dsh-workspace-tree/src/workspaceTreePlugin.ts（`SessionSnapshotFace.lastAgentError` 与 `watchOpenFailure` 里那次判据）',
  },
]

/** 一条依赖的出处文件在官方包目录里的相对路径（`@deepseek-ai` 前缀就是 root 本身）。 */
function expectPath(dep) {
  return `${dep.pkg}/${dep.file}`
}

/** 出处文件在磁盘上的绝对路径：root 是 `…/@deepseek-ai`，其下每个包一层目录。 */
function artifactPath(root, dep) {
  return path.join(root, dep.pkg.slice('@deepseek-ai/'.length), dep.file)
}

/**
 * 我们取用的官方图标在**官方前端产物**里的导出名是否还在（#236 立的表，#252 起 27 枚）。
 *
 * ## 为什么读前端产物、不读包文件
 *
 * 图标住在 `@deepseek-ai/dsh-client-ui-primitives`，但**这个包不在磁盘上**（实测：本机
 * profile 的 `@deepseek-ai/` 下 252 个包里没有它）。官方前端是把 primitives 直接打进页面
 * 自己那份 chunk 里（`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`），页面运行时
 * 再把那个模块的命名空间对象按模块 id 交给插件——我们的插件 require 到的就是这个对象。
 * 所以「导出名还在不在」只有两个查法：跑起网关看运行时对象（慢、要鉴权），或者读磁盘上
 * 那份 chunk 的导出表（本项走这条：离线、只读、与 `official-identifiers` 同一面）。
 * chunk 里那份导出表是一张 `{ 导出名: 内部名 }` 的字面量（0.1.6-alpha.2 实测
 * `…,IconCloseFill14:Ul,IconCloseOutline16:Vo,…`），所以「名字在不在」按整词查即可。
 *
 * ## 为什么不查 combo（`clientContract.mjs` 那一面）
 *
 * combo 是官方**插件**拼成的大文件，里面只有各插件**引用**过的那几个图标名。表里这些
 * 里，官方插件自己用到的只有一部分（实测 0.1.7-alpha.2 的 `@deepseek-ai/dsh-client-ui-*`
 * 各包：`IconChevronLeftOutline` / `IconCopyOutline` / `IconDownloadOutline` /
 * `IconFolderOpenOutline` / `IconRefreshOutline` / `IconRightUpOutline` / `IconSettingsOutline` /
 * `IconUserOutline` 这 8 枚官方自己没在这些插件里用过），查 combo 会把那 8 枚报成「上游删了」
 * 的假红。导出表在 chunk 里，所以这一项落在本文件。
 *
 * ## 判据
 *
 * 逐枚查「这一代要的名字（`<基名><档位>`）或上一代的名字（尺寸后缀名）」**至少一个在场**，
 * 两代任一在场即通过（两代名字的对照表 = `src/pure/officialIcons.ts`，与运行时挑名字用的
 * 是同一份表、同一份顺序）。**两个都不在场就是 fail**，detail 里逐枚写清是哪一枚、这一代
 * 要什么名、上一代要什么名——名字消失时页面上的表现是渲染崩成 React #130（元素类型是
 * `undefined`），那句话看不出是哪枚图标，所以这一项的意义就是「当场报名字」。
 */
export function checkOfficialIconExports({ root, version, profile }) {
  const assets = path.join(root, 'dsh-web-frontend', 'dist', 'assets')
  const name = `官方图标导出名在场（我们取用的 ${OFFICIAL_ICON_NAMES.length} 枚，两代名字任一在场即通过）`
  let files
  try {
    files = fs.readdirSync(assets).filter((file) => file.endsWith('.js')).sort()
  } catch {
    return {
      id: 'official-icon-exports',
      name,
      status: 'fail',
      detail: `读不到官方前端产物目录 ${assets}（读的是${profileLabel(profile)}）——图标名这一面未核实，不能当成没问题`,
    }
  }
  if (files.length === 0) {
    return {
      id: 'official-icon-exports',
      name,
      status: 'fail',
      detail: `${assets} 里没有 .js 产物——官方换了前端产物的打包方式，本项的取法要跟着改`,
    }
  }
  let text = ''
  for (const file of files) text += `${fs.readFileSync(path.join(assets, file), 'utf8')}\n`
  const missing = []
  for (const icon of OFFICIAL_ICON_NAMES) {
    const candidates = iconExportCandidates(icon)
    if (!candidates.some((candidate) => new RegExp(`\\b${candidate}\\b`).test(text))) {
      missing.push(`\`${icon}\`（这一代要 \`${candidates[0]}\`、上一代要 \`${candidates[1]}\`，两个都不在）`)
    }
  }
  return {
    id: 'official-icon-exports',
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: missing.length === 0
      ? `dsh ${version ?? 'unknown'}：${OFFICIAL_ICON_NAMES.length} 枚全部在场（读的是${profile}，${assets} 下 ${files.length} 个 js 产物、共 ${String(Math.round(text.length / 1024))} KB）`
      : `dsh ${version ?? 'unknown'} 缺 ${missing.length} 枚：${missing.join('；')}——名字消失 = 我们按它取用的插件会静默变 \`undefined\`、渲染时才崩成 React #130（#236）`,
  }
}

/** 出处目录是怎么来的（进 detail 便于定界）；没有说明时退回一句「被测树」。 */
function profileLabel(profile) {
  return typeof profile === 'string' && profile !== '' ? profile : '被测树'
}

/** 按真身解析符号链接；解不开就退回原路径（「文件在不在」由读文件那一步回答）。 */
export function resolveRealpath(target) {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

/**
 * 逐条查标识符是否还在（只读磁盘，不写、不联网）。
 *
 * `root` = 已解析好真身的官方包目录（`…/@deepseek-ai`，调用方用 `resolveRealpath` 解析）。
 * `profile` = 这个目录是怎么来的（被测实例自己的 profile / 被测 dsh 的安装树 / 本机默认 `~/.dsh`），进 detail 便于定界。
 * `version` = 被测 dsh 版本，只用于 detail 文案。
 *
 * 返回 probe.mjs 的结果行 `{ id, name, status, detail }`：任一条缺失即 fail，detail 里逐条
 * 给出**条目名、出处文件与我方使用点**——照它去查官方 release notes 或改我们的取用路径。
 */
export function checkOfficialIdentifiers({ root, version, profile }) {
  const versionLabel = version ?? 'unknown'
  const name = `官方内部标识符在场（本机官方产物 ${IDENTIFIERS.length} 条，存在性检查）`
  const missing = []
  const cache = new Map()
  const read = (file) => {
    if (!cache.has(file)) {
      let content = null
      try {
        content = fs.readFileSync(file, 'utf8')
      } catch {
        content = null
      }
      cache.set(file, content)
    }
    return cache.get(file)
  }

  for (const dep of IDENTIFIERS) {
    const content = read(artifactPath(root, dep))
    if (content === null) {
      missing.push(`${dep.id}（出处文件读不到 ${expectPath(dep)}；我方使用点 ${dep.where}）`)
    } else if (!dep.pattern.test(content)) {
      missing.push(`${dep.id}（${expectPath(dep)} 里已找不到 ${dep.pattern}；我方使用点 ${dep.where}）`)
    }
  }

  return {
    id: 'official-identifiers',
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: missing.length === 0
      ? `dsh ${versionLabel}：${IDENTIFIERS.length} 条全在场（读的是${profile}，路径 ${resolveRealpath(root)}）`
      : `dsh ${versionLabel} 缺 ${missing.length} 条：${missing.join('；')}`,
  }
}
