/**
 * block list 补全探针（#227）——对着**本机已安装的官方包**算每棵树补全后的 block list，
 * 与 `src/ui/assembly/wireFilter.ts` 里的现状对比。
 *
 * ## 这一项查的是什么
 *
 * 2026-09-22 的 alpha.2 事故（#225）：官方 `dsh-client-ui-plan` 在 0.1.6-alpha.2 里
 * 开始等 `uiConversation` 服务，而侧栏树把提供这个服务的 `ui-conversation` 下线了、
 * 却没下线它——官方启动审计报 `web boot: 1 entry did not activate`，侧栏页被失败卡
 * 挡住。**「少挡一条」这一类坏法在改装配代码之前谁也不知道**：只有当天的干净 profile
 * 上跑实验室才会现形（而且上游一发版就现形）。所以这里把「谁等谁」静态算出来，每次
 * 上游发版自动对比，结论进 upstream-watch issue。
 *
 * 算法与判据在 `src/pure/blockListDerivation.ts`（纯函数，`node --test` 直接测）；
 * 本文件只负责**取数据**（读本机官方包的清单与 bundle）与**报结果**（少挡了哪几条 /
 * 哪些手写条目是规则算不出来的 / profile 里哪几件第三方插件在这棵树里等不到服务）。
 *
 * ## 两类输入：官方那批包 + profile 里用户自己装的第三方插件（#242）
 *
 * 官方那批包从 `root`（`…/@deepseek-ai`）读；**profile 里用户装的第三方插件**从同一棵
 * profile 树下的 `profiles/<名>/package.json` 的 `dsh.profile.bundles` 读（见
 * `collectProfilePluginFaces`）——它们原来整批看不见，于是「第三方插件 inject 了我们这棵树
 * 里没有的服务」这件事离线算不出来（症状与 #225 一模一样）。两类插件的**处置不同**：
 * 官方件会被补进清单（少挡就是事故），第三方插件**只报不挡**（见 `unplaceableProfilePlugins`
 * 的注释：替用户挡掉等于静默移除他的插件）。
 *
 * ## 数据从哪来、为什么不是 `package.json` 的 `dsh.client.inject`
 *
 * 官方包清单里有两个 inject，看混就得出反的结论：
 *
 * - `package.json` 的 `dsh.client.inject`（= wire 里每个 entry 的 `inject`）是**模块 id**
 *   表，只决定装载顺序。按它做闭包会把依赖方一起挡掉，而依赖方并不会因为对方被挡而
 *   不激活（对话区那棵树挡了 `ui-layout`、`ui-conversation` 的模块表里就列着它，
 *   对话区照样全绿）。实测按模块表做闭包：chat 2 → 38、sidebar 13 → 39、
 *   settings 14 → 38 条，把对话区与官方侧栏壳都算进去了。取法自检见
 *   `test/blockListDerivation.test.ts` 里那条「按模块 id 表做闭包会把对话区与官方侧栏壳
 *   一起挡掉，按服务表不会」的用例。
 * - 官方 bundle（`lib/client.js`）导出的 `inject` 是**服务名**表，那才是启动审计的判据。
 *
 * 所以这里读 bundle：`needs` = 导出的 `inject` 数组，`provides` = 提供服务的调用点
 * （`super(ctx, "X")` / `ctx.reflect.provide("X", …)` / `ctx.provide("X", …)`）。
 *
 * ## 取不到就报红
 *
 * 四类情况一律 fail，不降级：① 某个包（官方或 profile 里的第三方）的 bundle 读不到
 * 或解析不出 `inject` 导出；② `dsh.profile.bundles` 里点了名的第三方包两个 node_modules
 * 下都找不到；③ 有插件在等的服务在官方包里找不到任何提供方、又不属于框架/主机层那一族
 * （`loader` / `modules` / `remote.*`，见 `isFrameworkService`）——那说明官方换了挂服务的
 * 写法、我们的取法漏了；④ 某棵树的补全结果里有条目没被手写清单覆盖（少挡）。
 * 「多挡」不算失败：形态类条目（官方外框、官方侧栏）本来就算不出来，多挡一条的代价只是
 * 少加载一个本来也不渲染的 entry。另有一类**单独报**：profile 里的第三方插件在某棵树里
 * 等不到服务（它在那棵树里起不来），处置与上面几类不同，见 `unplaceableProfilePlugins`。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  deriveBlockList,
  unaccountedBlocks,
  unplaceableProfilePlugins,
  unresolvedServices,
} from '../../src/pure/blockListDerivation.ts'

/**
 * 各棵树（#248 起四棵）的 frame 插件顶替了官方 `dsh-client-ui-layout` 提供的服务（#227）。
 *
 * 出处：`src/ui/assembly/shell/chatLayoutPlugin.ts:467`、`sidebarLayoutPlugin.ts:445`、
 * `settingsLayoutPlugin.ts:277` 都是 `ctx.reflect.provide('layout', …)`；官方那边同一个
 * 服务名在 `@deepseek-ai/dsh-client-ui-layout/lib/client.js`（`ctx.reflect.provide("layout", …)`）。
 * 官方件被下线、自有那份顶上，所以 `layout` 这个服务在四棵树里都还在——不把自有插件
 * 当提供方传进去，`layout` 会被当成「提供方全被挡掉」，连锁挡掉一片本来该用的官方件。
 */
export const FRAME_PLUGIN_PROVIDES = ['layout']

/**
 * `lib/client.js` 里导出的服务依赖表。三种写法都认（各自都是真实产物里出现过的形状）：
 *
 * - `const inject = [ … ]`（官方与自有产物：变量声明）；
 * - `exports.inject = [ … ]`（CommonJS 包装）；
 * - `<ident>.inject = [ … ]`（打包器把模块导出挂在一个局部变量上，如 `n.inject=[…]`；
 *   #242 现场那件 `@changfenhuang/dsh-genui` 就是这一种，写成 `n.inject=[\`slots\`,\`sessions\`]`）。
 *
 * 引号也一样：直引号与反引号都认（第三方打包器把字符串压成模板字面量是常态）。
 * 取不到时 `parseServiceFace` 返回 `null`，调用方报红——**不许静默算成「它什么都不需要」**。
 */
const INJECT_EXPORT =
  /(?:const|var|let)\s+inject\s*=\s*\[([\s\S]{0,800}?)\]|(?:[\w$]+\.)*inject\s*=\s*\[([\s\S]{0,800}?)\]/

/** 提供服务的调用点（三处都是官方在用的写法）。`provideRoot(` 这类别的 API 不会被命中。 */
const PROVIDE_CALLS = [
  /super\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g,
  /(?:reflect\.)?provide\(\s*"([^"]+)"/g,
]

/** 从一段 bundle 源码里取服务面；取不到 `inject` 导出时返回 `null`（调用方据此报红）。 */
export function parseServiceFace(source, id) {
  const match = INJECT_EXPORT.exec(source)
  if (match === null) return null
  const raw = match[1] ?? match[2] ?? ''
  const needs = [...raw.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
  const provides = new Set()
  for (const pattern of PROVIDE_CALLS) {
    pattern.lastIndex = 0
    for (const m of source.matchAll(pattern)) provides.add(m[1])
  }
  return { id, needs: [...new Set(needs)], provides: [...provides].sort() }
}

/** 官方包的 client 半在包里的相对路径（官方都用 `exports["./client"]`；取不到就退回惯例路径）。 */
function clientEntryRelPath(pkg) {
  const exp = pkg?.exports?.['./client']
  const file = typeof exp === 'string' ? exp : exp?.default
  return typeof file === 'string' ? file.replace(/^\.\//, '') : 'lib/client.js'
}

/**
 * 读 `root`（`…/@deepseek-ai`，调用方已按真身解析）下每个官方前端包的清单与 bundle。
 *
 * 返回 `{ faces, problems }`：`faces` 是服务面数组，`problems` 是「读不到 / 解析不出」的
 * 逐条说明（非空即说明这一面没核实，调用方报红）。
 */
export function collectOfficialServiceFaces(root) {
  const faces = []
  const problems = []
  let entries = []
  try {
    // 不用 withFileTypes 的 isDirectory 过滤：官方包目录里每条常常是指向安装树的符号链接
    // （`~/.dsh/profiles/node_modules/@deepseek-ai/*`），按 isDirectory 过滤会一条都读不到，
    // 而「一个包都没读到」又会静默算成「闭包是空的、各棵树的读法一致」。所以逐条试读清单。
    entries = fs.readdirSync(root).sort()
  } catch (error) {
    return { faces, problems: [`读不到官方包目录 ${root}：${String(error?.message ?? error)}`] }
  }
  for (const entry of entries) {
    const dir = path.join(root, entry)
    let pkg = null
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    } catch {
      continue // 不是包（或没有清单）：官方目录里只放包，跳过不算问题。
    }
    if (pkg?.dsh?.client === undefined) continue
    const id = typeof pkg.name === 'string' ? pkg.name : `@deepseek-ai/${entry}`
    const file = clientEntryRelPath(pkg)
    let source = null
    try {
      source = fs.readFileSync(path.join(dir, file), 'utf8')
    } catch {
      source = null
    }
    if (source === null) {
      problems.push(`${id}（读不到 ${file}）`)
      continue
    }
    const face = parseServiceFace(source, id)
    if (face === null) {
      problems.push(`${id}（${file} 里找不到导出的 inject 服务表）`)
      continue
    }
    faces.push(face)
  }
  return { faces, problems }
}

/**
 * `root`（`…/@deepseek-ai`）所在的那份 profile 树：`<X>/profiles/node_modules/@deepseek-ai`
 * → `<X>/profiles`。形状对不上（例如读的是安装树里的官方包）时返回 `null`
 * ——那时没有「用户的 profile」可读，调用方如实记一条事实，不假装读过。
 */
export function profilesRootOf(root) {
  const nodeModules = path.dirname(path.resolve(root))
  if (path.basename(nodeModules) !== 'node_modules') return null
  const profiles = path.dirname(nodeModules)
  return path.basename(profiles) === 'profiles' ? profiles : null
}

/**
 * 读 profile 里**用户自己装的第三方插件**的服务面（#242）。
 *
 * 从哪里认：每个 profile 目录（`<profilesRoot>/<profile>`）的 `package.json` 里
 * `dsh.profile.bundles` 那张表——它就是「这一层的网关会装哪些插件」，与用户装包走的那条
 * 官方命令（`dsh plugin --profile <name> add …`）写的是同一份。表里非 `@deepseek-ai` 的
 * 名字就是第三方插件（官方那一批由 `collectOfficialServiceFaces` 读，不重复）。
 *
 * 为什么不能只扫 `<profile>/node_modules` 目录：那里还有一堆是依赖（react / katex / …），
 * 以及装过又没进层列表的包；按包清单读才是「真装进这一层的插件」。
 *
 * 同一个 id 装在多个 profile 层里时**只算一次**（本机实测：`plan-test` 与 `web` 两层都装着
 * `@dsh-one/dsh-llm-provider`）：同一个 id 的服务面只有一份语义，重复报只会把同一件事说两遍。
 *
 * 返回 `{ faces, problems, profiles }`：
 * - `faces` 是第三方插件的服务面；
 * - `problems` 是「层列表点了名却没有 / 读不到 / 解析不出」的逐条说明（非空即这一面没核实，调用方报红）；
 * - `profiles` 是读过的 profile 目录名（写进结果行的 detail，说明读的是哪一份）。
 *
 * 一件 profile 层里的包没有 `dsh.client`（宿主半插件，没有浏览器半）时跳过——它不参与页面装配，
 * 谈不上「能不能激活」。
 */
export function collectProfilePluginFaces(profilesRoot) {
  const faces = []
  const problems = []
  const profiles = []
  const seen = new Set()
  let entries = []
  try {
    entries = fs.readdirSync(profilesRoot).sort()
  } catch (error) {
    return { faces, problems: [`读不到 profile 目录 ${profilesRoot}：${String(error?.message ?? error)}`], profiles }
  }
  for (const name of entries) {
    const profileDir = path.join(profilesRoot, name)
    let bundles = null
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
      bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : null
    } catch {
      continue // 不是 profile 目录（没有清单或清单读不出）：跳过不算问题。
    }
    if (bundles === null) continue
    profiles.push(name)
    for (const id of bundles) {
      if (typeof id !== 'string' || id.startsWith('@deepseek-ai/')) continue
      // 同一件装在多个 profile 层里时只算一次（见函数头）。
      if (seen.has(id)) continue
      // 装在 profile 自己的 node_modules 下；pnpm/npm 把依赖提到 `<profilesRoot>/node_modules`
      // 时也从那里找（同样的 id 在网关那边也是同一个包）。
      const dir = [path.join(profileDir, 'node_modules', id), path.join(profilesRoot, 'node_modules', id)].find((candidate) =>
        fs.existsSync(path.join(candidate, 'package.json')),
      )
      if (dir === undefined) {
        problems.push(`${id}（profile ${name} 的层列表里有它，但两个 node_modules 下都没有这个包）`)
        continue
      }
      let pkg = null
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      } catch (error) {
        problems.push(`${id}（profile ${name} 里读不到它的 package.json：${String(error?.message ?? error)}）`)
        continue
      }
      if (pkg?.dsh?.client === undefined) continue
      const file = clientEntryRelPath(pkg)
      let source = null
      try {
        source = fs.readFileSync(path.join(dir, file), 'utf8')
      } catch {
        problems.push(`${id}（读不到 ${file}）`)
        continue
      }
      const face = parseServiceFace(source, typeof pkg.name === 'string' ? pkg.name : id)
      if (face === null) {
        problems.push(`${id}（${file} 里找不到导出的 inject 服务表）`)
        continue
      }
      seen.add(id)
      faces.push(face)
    }
  }
  return { faces, problems, profiles }
}

/**
 * 跑本项检查，返回 probe.mjs 的结果行 `{ id, name, status, detail }`。
 *
 * `trees` 每项：`{ key, label, blocked, framePluginId }`（`blocked` 取自
 * `src/ui/assembly/wireFilter.ts` 里各棵树的清单，`framePluginId` 取该树的 frame 插件 id）。
 * 调用方给的是四棵装配树（`probe.mjs` 的 `BLOCK_LIST_TREES`，#248 起含 plugins 树）。
 */
export function checkBlockListDrift({ root, version, profile, trees }) {
  const { faces, problems } = collectOfficialServiceFaces(root)
  // #242：profile 里用户自己装的第三方插件也要看见——它们既不在官方那批包里，也不该被
  // 我们的清单挡掉，但「在这棵树里等不到服务」这件事必须算得出来。形状对不上（读的是安装树）
  // 时如实记一条事实，不假装读过。
  const profilesRoot = profilesRootOf(root)
  const profileRead = profilesRoot === null ? null : collectProfilePluginFaces(profilesRoot)
  const profileFaces = profileRead?.faces ?? []
  const name = `block list 补全（按官方服务依赖离线算出，本机官方包 ${faces.length} 件 + profile 第三方插件 ${profileFaces.length} 件）`
  const failure = [...problems, ...(profileRead?.problems ?? [])]
  if (faces.length === 0 && failure.length === 0) {
    failure.push('一个官方前端包都没读到——这一面未核实，不能当成没问题')
  }
  // 取法自检：自有插件（各树的 frame 插件）与第三方插件提供的那几个服务不算「找不到提供方」。
  const localProviders = trees.map((tree) => ({ id: tree.framePluginId, needs: [], provides: FRAME_PLUGIN_PROVIDES }))
  const unprovided = unresolvedServices({ plugins: faces, localProviders, profilePlugins: profileFaces })
  if (unprovided.length > 0) {
    failure.push(
      `有插件在等的服务在官方包里找不到提供方：${unprovided.join('、')}` +
        '（框架/主机层那一族 loader、modules、remote.* 不算；其余多半是官方换了挂服务的写法、取法要跟着改）',
    )
  }
  const perTree = []
  const unaccounted = []
  for (const tree of trees) {
    const providers = [{ id: tree.framePluginId, needs: [], provides: FRAME_PLUGIN_PROVIDES }]
    const input = { blocked: tree.blocked, plugins: faces, localProviders: providers, profilePlugins: profileFaces }
    const { blocked, added } = deriveBlockList(input)
    const hand = new Set(tree.blocked)
    const missing = blocked.filter((id) => !hand.has(id))
    const form = unaccountedBlocks(input)
    perTree.push(`${tree.label} 手写 ${tree.blocked.length} / 补全后 ${blocked.length}（少挡 ${missing.length}、规则算不出 ${form.length}）`)
    if (missing.length > 0) {
      const why = added
        .filter((a) => missing.includes(a.id))
        .map((a) => `${a.id}（等 ${a.waitingFor.join('、')}；提供方全被挡：${a.providers.join('、')}）`)
      failure.push(`${tree.label} 少挡了 ${missing.length} 条：${why.join('；')}`)
    }
    if (form.length > 0) {
      unaccounted.push(`${tree.label} 规则算不出的手写条目 ${form.length} 条（形态/角色理由，多挡无害）：${form.join('、')}`)
    }
    // 第三方插件在这棵树里等不到服务 = 它在这棵树里起不来（官方启动审计点名它、页面自愈把它
    // 从本页清单里摘掉；一次点名太多条时整页落到失败卡）。不补进清单——见 blockListDerivation
    // 里 unplaceableProfilePlugins 的注释：那不是我们的件，替用户挡掉是静默移除。
    const unplaceable = unplaceableProfilePlugins(input)
    if (unplaceable.length > 0) {
      const why = unplaceable.map((u) => `${u.id}（等 ${u.waitingFor.join('、')}；提供方全被挡：${u.providers.join('、')}）`)
      failure.push(
        `${tree.label} 放不下 profile 里的第三方插件 ${unplaceable.length} 件：${why.join('；')}` +
          '（它们在这棵树里会停在 pending，官方启动审计点名、页面自愈把这条从本页清单里摘掉；不替用户挡掉）',
      )
    }
  }
  const head = `dsh ${version ?? 'unknown'}（读的是${profile}，路径 ${root}）`
  const profileNote =
    profileRead === null
      ? `；profile 里的第三方插件这一面未读（官方产物不在 profiles/<名>/node_modules 形状下，没有 profile 可读）`
      : `；profile 里的第三方插件 ${profileFaces.length} 件（读的 profile：${profileRead.profiles.join('、') || '（没有 profile 目录）'}）`
  const summary = perTree.join('；')
  return {
    id: 'block-list-drift',
    name,
    status: failure.length === 0 ? 'pass' : 'fail',
    detail:
      failure.length === 0
        ? `${head}：各棵树逐棵一致——${summary}${unaccounted.length > 0 ? `；${unaccounted.join('；')}` : ''}${profileNote}`
        : `${head}：${failure.join('；')}（逐棵树读数：${summary}${profileNote}）`,
  }
}
