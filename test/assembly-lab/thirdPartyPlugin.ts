/**
 * 「profile 里装了一个第三方 dsh 插件」的现场（#237）：现造一个合成的第三方插件包、
 * 用官方的装包命令把它装进**隔离 profile**，再起一台真实例给夹具用。
 *
 * ## 为什么要有这个现场（#237 的用户现场）
 *
 * 我们对上游的假设里有一条从没被验证过：**「用户 profile 里只有官方插件 + 我们自己的
 * 插件」**。一位用户装了 `@changfenhuang/dsh-genui` 之后，dsh web 正常、dsh-one 整页
 * 起不来——我们转发的那份整包被**整份拒绝**，页面那一批模块一条都拿不到（连官方件一起
 * `import failed`）。
 *
 * ## 合成的这个包刻意复刻那个包的**形状**（不是行为）
 *
 * 那一起的真根因是「段的 id 怎么写」：官方与自有产物的注册头是双引号（
 * `window.__ModuleLoader__.load({ id: "…", factory: … })`，见
 * `@deepseek-ai/dsh-client-ui-layout/lib/client.js` 与
 * `dist/assembly/plugins/@dsh-one/vscode-theme-follow/client.js` 的开头），而那个包的
 * 产物是它自己的打包器压出来的一行、id 写成**模板字面量**：
 *
 * ```text
 * window.__ModuleLoader__.load({id:`@changfenhuang/dsh-genui`,factory:e=>{…}})
 * ```
 *
 * （0.11.0 的 `lib/client.js` 头 300 字节逐字如此。）镜像当时按
 * `/\bid:\s*"([^"]+)"/` 认段首 id，于是**这一条进不了「网关整包里有哪些 id」那张表**，
 * 被当成「本机插件」，名字又不像 `@dsh-one/*` → 整份请求 404。
 *
 * 所以这里那个合成包也写成**同样的一句话**：一行、`id:` 用模板字面量、`factory` 里
 * 导出 `inject` / `apply`（模块面与自有插件一致）。它起来之后会往 `<html>` 上写一个
 * 标记属性、并挂一个全局——夹具就按这两样断言「这个插件的条目真的在页面上跑起来了」。
 *
 * 它**不**复刻那个包的行为（不注册任何槽位、不认识任何官方服务），因为本夹具要验的是
 * 「一个第三方插件在场时装配页还能不能起来」，不是那个插件自己能不能渲染。
 *
 * ## 规则（与 freshGateway.ts 同口径，为的是不打扰用户与其它 session）
 *
 * - 隔离 `HOME`（`dsh plugin add` 认的是它）+ 该 HOME 下的 `DSH_HOME`（起实例用它）；
 * - 端口交给内核（`--port 0`）、`--no-open`；
 * - 收尾**按 PID** 杀（`SIGTERM` → 超时 `SIGKILL`），临时目录一起删，**不用 `pkill`**
 *   （那会连用户正在用的实例一起带走）。
 */
import { execFileSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { scratchDir } from '../scratchDirs.ts'
import { startFreshGateway, type FreshGateway } from './freshGateway.ts'

/** 合成第三方插件的 id（`@dsh-external/*` = 本仓对「别人的插件」的一贯写法）。 */
export const THIRD_PARTY_PLUGIN_ID = '@dsh-external/dsh-lab-third-party'

/** 插件起来之后写在 `<html>` 上的标记属性（夹具按它断言条目真的在页面上）。 */
export const THIRD_PARTY_MARK = 'data-lab-third-party'

/** 插件起来之后挂的全局（与标记属性同一个时刻写，两样都读，避免只看一个）。 */
export const THIRD_PARTY_GLOBAL = '__LAB_THIRD_PARTY__'

/**
 * 合成包的浏览器半：**一行、id 用模板字面量**（见文件头的形状说明），module 面与自有
 * 插件一致（`inject` + `apply`）。
 */
const CLIENT_JS =
  'window.__ModuleLoader__.load({id:`' +
  THIRD_PARTY_PLUGIN_ID +
  '`,factory:e=>{var t={exports:{}},n=t.exports;Object.defineProperty(n,Symbol.toStringTag,{value:`Module`});' +
  `var inject=[];function apply(ctx){try{globalThis["${THIRD_PARTY_GLOBAL}"]="${THIRD_PARTY_PLUGIN_ID}"}catch(e){}` +
  `try{document.documentElement.setAttribute("${THIRD_PARTY_MARK}","${THIRD_PARTY_PLUGIN_ID}")}catch(e){}}` +
  'n.inject=inject;n.apply=apply;return n}});'

/** `dsh` 可执行文件（与 freshGateway 同一个口径：`LAB_DSH` 可换）。 */
const DSH = process.env.LAB_DSH ?? 'dsh'

export interface ThirdPartyGateway extends FreshGateway {
  /** 这次运行现建的临时 `HOME`（`dsh plugin` 装的 profile 在它下面）。 */
  readonly profileHome: string
  /** 合成包的源码目录（`dsh plugin add file:` 的入参；收尾一起删）。 */
  readonly packageDir: string
}

/**
 * 造一个合成第三方插件包，装进隔离 profile，起一台实例。
 *
 * 装包走的是**官方那条命令**（`dsh plugin --profile web add file:<目录>`）：profile 的
 * `dsh.profile.bundles` 与 `node_modules` 由官方自己维护，与用户装第三方插件的路径逐字
 * 一致——夹具不该自己手改 profile 的清单（那样验的就不是这条路了）。
 *
 * 装包失败（`dsh` 不在 PATH、没有网络装依赖）时**直接抛错**：这一条夹具是新功能的门禁，
 * 不能因为装不上就安静地少跑一条（#193 的口径）。
 */
export async function startGatewayWithThirdPartyPlugin(options: {
  /** 等实例就绪的上限（缺省交给 freshGateway：90 秒）。 */
  timeoutMs?: number
  /** 每一行实例输出（诊断用）。 */
  onLine?: (line: string) => void
} = {}): Promise<ThirdPartyGateway> {
  const profileHome = await scratchDir('dsh-lab-thirdparty-')
  const packageDir = path.join(profileHome, 'source', 'dsh-lab-third-party')
  await writeSyntheticPackage(packageDir)
  const installLog: string[] = []
  try {
    installLog.push(
      execFileSync(DSH, ['plugin', '--profile', 'web', 'add', `file:${packageDir}`], {
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, HOME: profileHome },
      }),
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await fsp.rm(profileHome, { recursive: true, force: true })
    throw new Error(
      `lab: 合成第三方插件装不进隔离 profile（\`${DSH} plugin --profile web add file:…\`）：${detail}\n` +
        '这一条夹具要的就是「profile 里有一个第三方插件」的现场，装不上不能跳过。',
    )
  }
  const installed = JSON.parse(await fsp.readFile(path.join(profileHome, '.dsh', 'profiles', 'web', 'package.json'), 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  const bundles = installed.dsh?.profile?.bundles ?? []
  if (!bundles.includes(THIRD_PARTY_PLUGIN_ID)) {
    await fsp.rm(profileHome, { recursive: true, force: true })
    throw new Error(
      `lab: 合成第三方插件装完却没进 profile 的层列表（dsh.profile.bundles=${JSON.stringify(bundles)}）；装包记录：${installLog.join(' | ').slice(0, 400)}`,
    )
  }
  const gateway = await startFreshGateway({
    home: path.join(profileHome, '.dsh'),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.onLine === undefined ? {} : { onLine: options.onLine }),
  })
  return {
    ...gateway,
    profileHome,
    packageDir,
    dispose: async (): Promise<void> => {
      await gateway.dispose()
      await fsp.rm(profileHome, { recursive: true, force: true })
    },
  }
}

/** 写出合成包（清单 + 补丁 + 宿主半 + 浏览器半；见文件头）。 */
async function writeSyntheticPackage(dir: string): Promise<void> {
  await fsp.mkdir(path.join(dir, 'lib'), { recursive: true })
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: THIRD_PARTY_PLUGIN_ID,
        version: '0.0.1',
        description: 'Synthetic third-party dsh web plugin (assembly-lab fixture, #237).',
        type: 'module',
        main: 'lib/index.js',
        exports: { '.': { default: './lib/index.js' }, './client': { default: './lib/client.js' } },
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [] } },
      },
      null,
      2,
    )}\n`,
  )
  await fsp.writeFile(
    path.join(dir, 'cordis.patch.yml'),
    `# 合成第三方插件的 profile 层补丁：只插自己一行（形状与自有插件包一致）。\n- insert:\n    - id: lab-third-party\n      name: '${THIRD_PARTY_PLUGIN_ID}'\n`,
  )
  await fsp.writeFile(path.join(dir, 'lib', 'index.js'), `export const name = 'lab-third-party'\nexport function apply() {}\n`)
  await fsp.writeFile(path.join(dir, 'lib', 'client.js'), CLIENT_JS)
}

/** 页面上那两个读数（标记属性 + 全局）：夹具用它断言这个第三方插件真的跑起来了。 */
export interface ThirdPartyReading {
  mark: string | null
  global: string | null
}

/** 读页面上的第三方插件标记（`openTreePage` 之外再读一格，见 {@link ThirdPartyReading}）。 */
export async function readThirdParty(page: { evaluate: <T>(fn: () => T) => Promise<T> }): Promise<ThirdPartyReading> {
  return page.evaluate(() => ({
    mark: document.documentElement.getAttribute('data-lab-third-party'),
    global: (globalThis as { __LAB_THIRD_PARTY__?: string }).__LAB_THIRD_PARTY__ ?? null,
  }))
}
