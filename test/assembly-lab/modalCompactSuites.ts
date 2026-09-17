/**
 * 弹窗的紧凑档（#127）：七个对话框逐个开出来量几何，读数逐项落在官方档位表里。
 * #139 起把「管理分组…」的**第二层**（成员清单：返回键 / 搜索框 / 批量按钮 / 成员行与
 * 勾选件）也在同一个弹窗里量一遍——弹窗的每一层都归这条套件管。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与其它的独立套件文件同一条：那个文件是本批
 * 开发的合入热点（末尾只加一行注册）。
 *
 * 期望值**不硬编码**：几何读数直接与 `workspaceTree/styles.ts` 的 `SCALE_TIERS` 比
 * （出处判定复用 `scaleSuites.ts` 的 `sourceOf`，与 F-23 SCALE 同口径）；档位表管不到的
 * 那一族（标签组色板，`SCALE_EXEMPT` 里逐条写了理由）只记事实、不判失败——例外名单本身
 * 也从 `SCALE_EXEMPT` 读，源码层断言与运行期断言因此不会各说一套。
 *
 * 本套件**不动网关的写面**：七个弹窗逐个开出来量几何、按 Esc / 取消关掉；唯一一次点
 * 「确认归档」的请求由页内夹具接住（`workspace/archiveSession` 不落到网关），用来量 busy 态。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage, isText, hasText } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_EXEMPT, SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { sourceOf } from './scaleSuites.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 要量的探针：选择器相对当前的 `[role="dialog"]`（`all: true` = 逐个匹配的元素都量）。 */
const PROBES: ReadonlyArray<{ label: string; selector: string; props: readonly string[]; all?: boolean }> = [
  { label: '对话框', selector: '', props: ['borderRadius'] },
  { label: '头行', selector: '.dshOneTree_modalHead', props: ['height'] },
  { label: '标题', selector: '.dshOneTree_modalTitle', props: ['fontSize', 'lineHeight'] },
  { label: '关闭钮', selector: '.dshOneTree_modalClose', props: ['width', 'height', 'borderRadius'] },
  { label: '说明行', selector: '.dshOneTree_modalDesc', props: ['fontSize', 'lineHeight'] },
  { label: '底部按钮', selector: '.dshOneTree_modalActions button', props: ['height', 'fontSize', 'lineHeight', 'borderRadius'], all: true },
  { label: '输入框', selector: '.dshOneTree_renameInput', props: ['height', 'fontSize', 'lineHeight', 'borderRadius'], all: true },
  { label: '错误行', selector: '.dshOneTree_renameError', props: ['fontSize', 'lineHeight'], all: true },
  { label: '管理行', selector: '.dshOneTree_manageRow', props: ['height'], all: true },
  { label: '管理行名字', selector: '.dshOneTree_manageName', props: ['fontSize', 'lineHeight'], all: true },
  { label: '管理行计数', selector: '.dshOneTree_manageCount', props: ['fontSize', 'lineHeight'], all: true },
  // #139：管理分组的第二层（成员清单）——返回键、搜索框、批量按钮、成员行与其勾选件
  // （这一层由本套件在下面那一节开出来量一遍；F-39 另在三档宽度下重量）。
  { label: '返回键', selector: '.dshOneTree_modalBack', props: ['width', 'height', 'borderRadius'] },
  { label: '成员行', selector: '.dshOneTree_memberRow', props: ['height', 'borderRadius'], all: true },
  { label: '成员行名字', selector: '.dshOneTree_memberName', props: ['fontSize', 'lineHeight'], all: true },
  { label: '计数行', selector: '.dshOneTree_memberCount', props: ['fontSize', 'lineHeight'], all: true },
  { label: '勾选件', selector: '.dshOneTree_checkBox', props: ['width', 'height', 'borderRadius'] },
  { label: '归档块头', selector: '.dshOneTree_modalBlockLabel', props: ['fontSize', 'lineHeight'], all: true },
  { label: '归档明细行', selector: '.dshOneTree_modalRow', props: ['height', 'fontSize', 'lineHeight'], all: true },
  { label: '状态行', selector: '.dshOneTree_deleteStatus', props: ['fontSize', 'lineHeight'], all: true },
  { label: '色板色块', selector: '.dshOneTree_tagColorPickItem', props: ['width', 'height', 'borderRadius'], all: true },
]

interface ProbeReading {
  label: string
  /** 匹配到的元素的 class（例外名单按它认族）。 */
  classNames: string[]
  /** 每个匹配元素一份读数（每份都是「写死的长度」；auto / 百分比 / calc 不进表）。 */
  readings: Record<string, string>[]
}

/** 量当前对话框的全部探针（页面侧一次算完）。 */
async function dialogProbes(page: OpenedPage['page']): Promise<ProbeReading[]> {
  return page.evaluate((list: ReadonlyArray<{ label: string; selector: string; props: readonly string[]; all?: boolean }>) => {
    const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return []
    const out: { label: string; classNames: string[]; readings: Record<string, string>[] }[] = []
    for (const probe of list) {
      const found = probe.selector === '' ? [dialog] : Array.from(dialog.querySelectorAll(probe.selector))
      const picked = probe.all === true ? found : found.slice(0, 1)
      if (picked.length === 0) continue
      const readings: Record<string, string>[] = []
      for (const element of picked) {
        const computed = getComputedStyle(element)
        const reading: Record<string, string> = {}
        for (const prop of probe.props) {
          const value = computed.getPropertyValue(kebab(prop)).trim()
          // 只收「写死的长度」：自动值 / 百分比 / calc 由布局决定，不是档位能管的东西
          //（口径与 F-23 SCALE 一致：读 computed，不读矩形）。
          if (!/^\d+(\.\d+)?px$/.test(value)) continue
          reading[prop] = value
        }
        if (Object.keys(reading).length > 0) readings.push(reading)
      }
      if (readings.length > 0) out.push({ label: probe.label, classNames: picked.map((element) => element.className), readings })
    }
    return out
  }, PROBES)
}

/**
 * 量一个弹窗：探针读数 + ① 的判定（每条读数都要能在档位表里按属性找到出处；例外名单里的
 * 那一族只记事实）。
 */
async function auditModal(page: OpenedPage['page'], check: Check, name: string): Promise<void> {
  const probes = await dialogProbes(page)
  check.ok(`${name}：弹窗开出来了（能读到探针）`, probes.length >= 3, `读到 ${String(probes.length)} 组探针`)
  // 逐个控件把量到的读数写进报告（人工审查要看的「改了之后的量值」就是这一行），外加对话框
  // 自己的整体尺寸（用户感知最直接的那个数：同一个弹窗改前改后差多少）。
  const box = await page.evaluate(() => {
    const element = document.querySelector('[role="dialog"]')
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  check.fact(`${name} 对话框整体尺寸：${JSON.stringify(box)}`)
  check.fact(
    `${name} 量到的几何：${probes
      .map((probe) => `${probe.label}=${JSON.stringify(probe.readings[0] ?? {})}`)
      .join('；')}`,
  )
  for (const probe of probes) {
    const exempt = SCALE_EXEMPT.find((entry) => probe.classNames.some((className) => className.includes(entry.selector)))
    for (const prop of PROBES.find((item) => item.label === probe.label)?.props ?? []) {
      const values = [...new Set(probe.readings.map((reading) => reading[prop] ?? '').filter((value) => value !== ''))]
      if (values.length === 0) continue
      const seen = values.join(' / ')
      if (exempt !== undefined) {
        check.fact(`${name}：${probe.label} 的 ${prop} = ${seen}（例外清单内：${exempt.selector}）`)
        continue
      }
      const source = values.length === 1 ? sourceOf(prop, values[0] as string) : null
      check.ok(
        `${name}：${probe.label} 的 ${prop} = ${seen} 能在档位表里找到出处`,
        source !== null,
        `${source ?? '不在档位表里（自造值）'}${values.length === 1 ? '' : '（同一处控件取值不一致）'}`,
      )
    }
  }
}

/** 关掉当前弹窗（Esc）并等它卸载。 */
async function closeModal(page: OpenedPage['page']): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

/** 当前对话框的数量（0 = 没开着）。 */
const dialogCount = (page: OpenedPage['page']): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)

/** 分组胶囊下拉里的某一项（`group-new` / `group-manage`）。 */
async function pillAction(page: OpenedPage['page'], action: string): Promise<void> {
  await page.click('[data-dshone-tree-action="group-pill"]')
  await page.waitForSelector(`[data-dshone-tree-action="${action}"]`)
  await page.click(`[data-dshone-tree-action="${action}"]`)
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(150)
}

interface BlockFixture {
  /** 工作区块的键（标签组桶按它寻址）。 */
  key: string
  /** 块里第一条「有 ⋯ 按钮」的会话 id。 */
  session: string
  /** 第一条真实工作区行的序号（右键菜单挂在它上面）。 */
  workspaceIndex: number
}

/** 夹具：一个有会话行的工作区块 + 一条真实工作区行的序号。 */
async function blockFixture(page: OpenedPage['page']): Promise<BlockFixture | null> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))
    const workspaceIndex = rows.findIndex((row) => (row.getAttribute('data-dshone-tree-key') ?? '') !== '')
    for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
      const session = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).find(
        (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
      )
      const id = session?.getAttribute('data-dshone-tree-session') ?? ''
      if (id !== '') return { key: section.getAttribute('data-dshone-group-key') ?? '', session: id, workspaceIndex }
    }
    return null
  })
}

/** 会话行 ⋯ 菜单里的某一项。 */
async function sessionMenuItem(page: OpenedPage['page'], sessionId: string, item: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('[data-dshone-tree-action="session-menu"]').click()
  await page.waitForSelector(`[data-dshone-tree-item="${item}"]`)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(200)
}

/** 工作区行右键菜单里的某一项。 */
async function workspaceMenuItem(page: OpenedPage['page'], index: number, item: string): Promise<void> {
  await page.locator('[data-dshone-tree-row="workspace"]').nth(index).click({ button: 'right', position: { x: 60, y: 12 } })
  await page.waitForSelector(`[data-dshone-tree-item="${item}"]`)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(150)
}

/** 危险色按钮与同框里的普通按钮（几何 + 颜色 + 官方错误色 token 的解析值）。 */
async function dangerFacts(
  page: OpenedPage['page'],
): Promise<{ danger: { color: string; height: string; text: string }; normal: { color: string; height: string }; token: string } | null> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return null
    const danger = dialog.querySelector('button.dshOneTree_deleteAction')
    const normal = dialog.querySelector('.dshOneTree_modalActions button:not(.dshOneTree_deleteAction)')
    if (danger === null || normal === null) return null
    // token 的解析值：把同一个 token 挂到一个探针元素上量（比对着官方变量表猜值稳）。
    const probe = document.createElement('span')
    probe.style.color = 'var(--dsw-alias-state-error-primary)'
    dialog.appendChild(probe)
    const token = getComputedStyle(probe).color
    probe.remove()
    return {
      danger: { color: getComputedStyle(danger).color, height: getComputedStyle(danger).height, text: danger.textContent ?? '' },
      normal: { color: getComputedStyle(normal).color, height: getComputedStyle(normal).height },
      token,
    }
  })
}

interface NarrowFacts {
  viewport: number
  dialogLeft: number
  dialogRight: number
  dialogWidth: number
  dialogScrollWidth: number
  dialogClientWidth: number
  pageScrollWidth: number
  pageClientWidth: number
  actionsScrollWidth: number
  actionsClientWidth: number
  /** 输入框与按钮：是否都在对话框之内、是否被裁切。 */
  controls: ReadonlyArray<{ kind: string; left: number; right: number; width: number; scrollWidth: number; clientWidth: number }>
}

/** 窄宽度下的溢出与裁切事实。 */
async function narrowFacts(page: OpenedPage['page']): Promise<NarrowFacts | null> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null
    if (dialog === null) return null
    const box = dialog.getBoundingClientRect()
    const actions = dialog.querySelector('.dshOneTree_modalActions') as HTMLElement | null
    const controls = [
      ...Array.from(dialog.querySelectorAll('.dshOneTree_renameInput')).map((element) => ({ kind: '输入框', element })),
      ...Array.from(dialog.querySelectorAll('.dshOneTree_modalActions button')).map((element) => ({ kind: '按钮', element })),
    ].map(({ kind, element }) => {
      const rect = element.getBoundingClientRect()
      const node = element as HTMLElement
      return { kind, left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }
    })
    return {
      viewport: window.innerWidth,
      dialogLeft: box.left,
      dialogRight: box.right,
      dialogWidth: box.width,
      dialogScrollWidth: dialog.scrollWidth,
      dialogClientWidth: dialog.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      actionsScrollWidth: actions?.scrollWidth ?? -1,
      actionsClientWidth: actions?.clientWidth ?? -1,
      controls,
    }
  })
}

export const MODAL_COMPACT_SUITE: LabSuite = {
  id: 'F-34',
  phase: 'new-feature',
  name: '弹窗的紧凑档：七个对话框逐个量几何 + 危险色可分 + 260px 不溢出 + 行为回归（#127，MODAL-COMPACT 套件）',
  expect:
    '侧栏在真实装配页上（真网关**只读** + 假宿主 + 注入的分组状态）把七个弹窗逐个开出来（分组新建/重命名/删除、管理分组、归档确认、标签组新建/删除、会话与工作区重命名、删除工作区）：① **每一处几何都能在官方档位表里按属性找到出处**——对话框圆角、头行高、标题字号与行高、关闭钮宽高与圆角、说明行、底部按钮（官方 Button 的 `sm` 档：高 28px / 字号 12px / 行高 18px / 圆角 14px）、输入框（高 26px / 圆角 5px / 字号 12px / 行高 18px）、错误行与状态行、管理行高与其名字计数、**管理分组第二层（成员清单）的返回键 / 搜索框 / 批量按钮 / 成员行与其勾选件**、归档明细行与块头，逐项都在 `styles.ts` 那份档位表里；档位表管不到的那一族（标签组色板，`SCALE_EXEMPT` 里逐条写了理由）只记事实、不判失败。② **危险动作在紧凑档下仍与普通按钮视觉可分**：危险按钮的文字色解析出来就是官方 `--dsw-alias-state-error-primary`（拿同一枚 token 挂在探针上比），与同框里的普通按钮**不同色**，而两者**同高**（差异只在颜色，不是把 danger 档压没了）。③ **260px 窄宽度下不溢出、不裁切**：对话框左右缘都在视口内、`scrollWidth ≤ clientWidth`，页面无横向溢出，底部按钮行不换行溢出，框里每个输入框与按钮的矩形都在对话框之内且内容没有被裁切（`scrollWidth ≤ clientWidth + 1`）。④ **行为零变化**四条各一条断言：**必填校验**（分组新建：空名时确认钮禁用；填一个重名 → 错误行出现且确认钮仍禁用）、**Esc 与点外关闭**（Esc 关掉；再开一次点遮罩关掉）、**busy 态**（点「确认归档」后请求被页内夹具接住：两枚按钮都禁用、确认钮文案变「归档中…」，夹具放行后请求不落到网关）、**二次确认**（管理分组里点 🗑 只开出确认框、宿主状态里的分组定义一条不动，取消后分组仍在）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const groupsState = {
      version: 1,
      groups: [
        { id: 'g-lab-one', name: 'Lab One' },
        { id: 'g-lab-two', name: 'Lab Two' },
      ],
      membership: {},
      activeGroupId: null,
    }
    check.fact(`档位表取值：compact=${JSON.stringify(SCALE_TIERS.compact)}；buttonSm=${JSON.stringify(SCALE_TIERS.buttonSm)}`)
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: groupsState },
    })
    const { page } = opened
    // 归档确认的请求由页内夹具接住（先按住不放，验 busy 态时再放行）——绝不落到网关。
    const archiveHold: { release: (() => void) | null } = { release: null }
    let archiveCalls = 0
    await page.route('**/api/**', async (r) => {
      const method = decodeURIComponent(r.request().url()).split('/api/')[1] ?? ''
      if (!method.startsWith('workspace/archiveSession')) {
        await r.continue()
        return
      }
      archiveCalls += 1
      await new Promise<void>((resolve) => {
        archiveHold.release = resolve
      })
      const rpcId = (JSON.parse(r.request().postData() ?? '{}') as { rpcId?: string }).rpcId ?? ''
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'lab/forced', message: 'lab: archive held by fixture', details: {} } },
        }),
      })
    })
    try {
      // 把工作区行逐行展开（会话行要展开才在 DOM 里）——与其它套件的 expandAllGroups 同一做法。
      await page.evaluate(() => {
        for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
          if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
        }
      })
      await page.waitForTimeout(500)
      const fixture = await blockFixture(page)
      check.ok('页面上找到可用的夹具（一个带会话行的工作区块 + 一条真实工作区行）', fixture !== null, JSON.stringify(fixture))
      if (fixture === null) return screenshots
      check.fact(`夹具：区块键=${fixture.key}、会话=${fixture.session}、工作区行序号=${String(fixture.workspaceIndex)}`)

      // ---- ① 分组新建（GroupModal 的 create 形态）----
      await pillAction(page, 'group-new')
      check.eq('分组新建：弹窗开出来了', await dialogCount(page), 1)
      await auditModal(page, check, '分组新建')
      screenshots.push(await shot(page, 'modal-group-create'))

      // ---- ④ 必填校验：空名禁用 → 重名报错 ----
      const groupCreateButtons = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const buttons = Array.from(dialog?.querySelectorAll('.dshOneTree_modalActions button') ?? [])
        return buttons.map((button) => ({ text: button.textContent ?? '', disabled: (button as HTMLButtonElement).disabled }))
      })
      check.ok(
        '必填校验：空名时确认钮禁用（取消钮不受影响）',
        groupCreateButtons.some((button) =>isText(button.text, '新建分组') && button.disabled) &&
          groupCreateButtons.some((button) =>isText(button.text, '取消') && !button.disabled),
        JSON.stringify(groupCreateButtons),
      )
      await page.fill('.dshOneTree_renameInput', 'Lab One')
      await page.waitForTimeout(150)
      const duplicate = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const error = dialog?.querySelector('.dshOneTree_renameError') ?? null
        // 「确认钮」= 弹窗动作行里最后一枚（文案随页面语言变，所以按位置认，不按文字认）。
        const confirm = Array.from(dialog?.querySelectorAll('.dshOneTree_modalActions button') ?? []).at(-1)
        return { text: error?.textContent ?? '', role: error?.getAttribute('role') ?? '', disabled: (confirm as HTMLButtonElement | undefined)?.disabled ?? false }
      })
      check.ok('必填校验：重名时错误行出现（红字、role=alert）', duplicate.text !== '' && duplicate.role === 'alert', JSON.stringify(duplicate))
      check.ok('必填校验：重名时确认钮仍禁用（提交被挡住）', duplicate.disabled, JSON.stringify(duplicate))
      await page.fill('.dshOneTree_renameInput', '')

      // ---- ④ Esc 关闭：再开一次、再点遮罩关闭 ----
      await closeModal(page)
      check.eq('Esc 关闭：弹窗卸载了', await dialogCount(page), 0)
      await pillAction(page, 'group-new')
      await page.mouse.click(6, 6)
      await page.waitForTimeout(250)
      check.eq('点外关闭（遮罩）：弹窗卸载了', await dialogCount(page), 0)

      // ---- ① 管理分组（截图里那一个）----
      await pillAction(page, 'group-manage')
      await auditModal(page, check, '管理分组')
      screenshots.push(await shot(page, 'modal-manage-groups'))
      const manageRows = await page.evaluate(
        () => Array.from(document.querySelectorAll('[data-dshone-manage-group]')).map((row) => row.getAttribute('data-dshone-manage-group') ?? ''),
      )
      check.ok('管理分组：列表里就是注入的两个分组', manageRows.length === 2, JSON.stringify(manageRows))

      // ---- ① 管理分组的第二层（#139 的成员清单）----
      // 点分组名进成员清单：返回键、搜索框、批量按钮、成员行与其勾选件都在这一个弹窗里，
      // 所以几何也在这里量一遍（「弹窗的紧凑档」这条套件的覆盖面 = 每个弹窗的每一层）。
      await page.click(`[data-dshone-manage-group="${manageRows[0] as string}"] [data-dshone-tree-action="group-members"]`)
      await page.waitForSelector('[data-dshone-tree="group-members"]')
      await page.waitForTimeout(200)
      await auditModal(page, check, '管理分组·成员清单')
      screenshots.push(await shot(page, 'modal-manage-members'))
      const memberRows = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-dshone-member-row]').length,
        marks: document.querySelectorAll('[data-dshone-member-row] .dshOneTree_checkBox').length,
        back: document.querySelector('[data-dshone-tree-action="group-members-back"]') !== null,
      }))
      check.ok(
        '成员清单：每一行都带勾选件、返回键在场（本层是管理框的第二级）',
        memberRows.rows === memberRows.marks && memberRows.back,
        JSON.stringify(memberRows),
      )
      await page.click('[data-dshone-tree-action="group-members-back"]')
      await page.waitForSelector('[data-dshone-tree="group-manage-list"]')
      await page.waitForTimeout(200)
      check.eq('成员清单：返回键回到分组列表（同一个弹窗、不是新开一个）', await dialogCount(page), 1)

      // ---- ④ 二次确认：行内 🗑 只开确认框，分组定义一条不动 ----
      const before = await page.evaluate(
        () => JSON.stringify((globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__?.stateStore?.groups ?? null),
      )
      await page.click(`[data-dshone-manage-group="${manageRows[0] as string}"] [data-dshone-tree-action="group-delete"]`)
      await page.waitForTimeout(250)
      check.eq('二次确认：行内 🗑 开出的是「删除分组」确认框（管理框已收起）', await dialogCount(page), 1)
      await auditModal(page, check, '删除分组确认')
      const confirmText = await page.textContent('[role="dialog"] .dshOneTree_modalDesc').catch(() => null)
      check.ok('二次确认：确认框里写明了要删哪一个', (confirmText ?? '').includes('Lab One'), String(confirmText))
      const after = await page.evaluate(
        () => JSON.stringify((globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__?.stateStore?.groups ?? null),
      )
      check.eq('二次确认：只是开了框，宿主状态里的分组定义一条不动', after, before)
      screenshots.push(await shot(page, 'modal-group-delete'))
      // 危险色按钮与同框普通按钮（② 的第一处）。
      const groupDanger = await dangerFacts(page)
      check.ok('删除分组：框里有危险色按钮与普通按钮可比', groupDanger !== null, JSON.stringify(groupDanger))
      if (groupDanger !== null) {
        check.eq('删除分组：危险按钮的文字色 = 官方错误色 token', groupDanger.danger.color, groupDanger.token)
        check.ok('删除分组：危险按钮与普通按钮不同色（视觉可分）', groupDanger.danger.color !== groupDanger.normal.color, JSON.stringify(groupDanger))
        check.eq('删除分组：两者同高（差异只在颜色，danger 档没被压没）', groupDanger.danger.height, groupDanger.normal.height)
      }
      await closeModal(page)
      const stillThere = await page.evaluate(
        () => JSON.stringify((globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__?.stateStore?.groups ?? null),
      )
      check.eq('二次确认：取消之后分组仍在（没有落任何写）', stillThere, before)

      // ---- ① 分组重命名（同一个 GroupModal 的 rename 形态）----
      await pillAction(page, 'group-manage')
      await page.click(`[data-dshone-manage-group="${manageRows[0] as string}"] [data-dshone-tree-action="group-rename"]`)
      await page.waitForTimeout(250)
      await auditModal(page, check, '分组重命名')
      await closeModal(page)

      // ---- ① 重命名工作区（RenameModal）----
      await workspaceMenuItem(page, fixture.workspaceIndex, 'rename')
      await auditModal(page, check, '重命名工作区')
      screenshots.push(await shot(page, 'modal-rename-workspace'))
      await closeModal(page)

      // ---- ① 删除工作区确认（DeleteWorkspaceModal）----
      await workspaceMenuItem(page, fixture.workspaceIndex, 'remove')
      await auditModal(page, check, '删除工作区确认')
      const workspaceDanger = await dangerFacts(page)
      check.ok('删除工作区：框里有危险色按钮与普通按钮可比', workspaceDanger !== null)
      if (workspaceDanger !== null) check.eq('删除工作区：危险按钮的文字色 = 官方错误色 token', workspaceDanger.danger.color, workspaceDanger.token)
      screenshots.push(await shot(page, 'modal-delete-workspace'))
      await closeModal(page)

      // ---- ① 新建标签组（TagGroupCreateModal；顺手把组建出来，后两个弹窗要用它）----
      await sessionMenuItem(page, fixture.session, 'moveToGroup')
      await page.click('[data-dshone-tree-item="tag:__new"]')
      await page.waitForSelector('[role="dialog"]')
      await page.waitForTimeout(150)
      await auditModal(page, check, '新建标签组')
      screenshots.push(await shot(page, 'modal-tag-create'))
      const colorPick = await page.evaluate(() => document.querySelectorAll('[data-dshone-tag-color]').length)
      check.eq('新建标签组：6 色色板一枚不少', colorPick, 6)
      await page.fill('[data-dshone-tree="tag-name-input"]', 'Lab Tag')
      await page.click('[data-dshone-tree-action="tag-create-confirm"]')
      await page.waitForTimeout(400)
      const tagId = await page.evaluate(() => document.querySelector('[data-dshone-tree-tag]')?.getAttribute('data-dshone-tree-tag') ?? '')
      check.ok('新建标签组：确认后真的建出来了（组块出现）', tagId !== '', tagId)

      // ---- ① 重命名标签组 / 删除标签组确认 ----
      if (tagId !== '') {
        const block = page.locator(`[data-dshone-tree-tag="${tagId}"]`)
        await block.hover()
        await page.waitForTimeout(150)
        await block.locator('[data-dshone-tree-action="tag-menu"]').click()
        await page.waitForSelector('[data-dshone-tree-item="tag-rename"]')
        await page.click('[data-dshone-tree-item="tag-rename"]')
        await page.waitForSelector('[role="dialog"]')
        await page.waitForTimeout(150)
        await auditModal(page, check, '重命名标签组')
        await closeModal(page)

        await block.hover()
        await page.waitForTimeout(150)
        await block.locator('[data-dshone-tree-action="tag-menu"]').click()
        await page.waitForSelector('[data-dshone-tree-item="tag-delete"]')
        await page.click('[data-dshone-tree-item="tag-delete"]')
        await page.waitForSelector('[role="dialog"]')
        await page.waitForTimeout(150)
        await auditModal(page, check, '删除标签组确认')
        const tagDanger = await dangerFacts(page)
        check.ok('删除标签组：框里有危险色按钮与普通按钮可比', tagDanger !== null)
        if (tagDanger !== null) {
          check.eq('删除标签组：危险按钮的文字色 = 官方错误色 token', tagDanger.danger.color, tagDanger.token)
          check.ok('删除标签组：与普通按钮不同色', tagDanger.danger.color !== tagDanger.normal.color)
        }
        screenshots.push(await shot(page, 'modal-tag-delete'))
        await closeModal(page)
      }

      // ---- ① 归档确认（ArchiveSessionsModal）----
      const archiveTrigger = async (): Promise<boolean> => {
        await page.click('[data-dshone-tree-action="select-mode"]')
        await page.waitForTimeout(250)
        const target = await page.evaluate(
          () =>
            document.querySelector('[data-dshone-tree-row="session"][data-dshone-tree-check="eligible"]')?.getAttribute('data-dshone-tree-session') ?? null,
        )
        if (target === null) return false
        await page.locator(`[data-dshone-tree-session="${target}"]`).click()
        await page.waitForTimeout(200)
        await page.click('[data-dshone-tree-action="selection-archive"]')
        await page.waitForTimeout(350)
        return true
      }
      check.ok('归档确认：页面上有够格勾选的会话行（归档入口的夹具）', await archiveTrigger())
      await auditModal(page, check, '归档确认')
      screenshots.push(await shot(page, 'modal-archive-confirm'))
      const blocks = await page.evaluate(() => document.querySelectorAll('[data-dshone-archive-block]').length)
      const rows = await page.evaluate(() => document.querySelectorAll('[data-dshone-archive-row]').length)
      check.ok('归档确认：明细按工作区列出来了（块与行都在）', blocks >= 1 && rows >= 1, `块=${String(blocks)} 行=${String(rows)}`)

      // ---- ④ busy 态：点确认 → 请求被夹具按住 → 两枚按钮都禁用、文案变「归档中…」----
      await page.click('[data-dshone-tree-action="archive-confirm"]')
      await page.waitForTimeout(300)
      const busy = await page.evaluate(() => {
        const confirm = document.querySelector('[data-dshone-tree-action="archive-confirm"]') as HTMLButtonElement | null
        const buttons = Array.from(document.querySelectorAll('[role="dialog"] .dshOneTree_modalActions button'))
        return {
          text: confirm?.textContent ?? '',
          disabled: buttons.map((button) => (button as HTMLButtonElement).disabled),
          calls: 0,
        }
      })
      check.fact(`busy 态：确认钮文案=${JSON.stringify(busy.text)} 按钮禁用=${JSON.stringify(busy.disabled)} 夹具接到的归档请求=${String(archiveCalls)}`)
      check.ok('busy 态：确认钮文案变成「正在归档…」', hasText(busy.text, '正在归档…'), busy.text)
      check.ok('busy 态：两枚按钮都禁用（不会重复提交、也不许中途关掉）', busy.disabled.every(Boolean) === true && busy.disabled.length === 2, JSON.stringify(busy.disabled))
      check.ok('busy 态：请求真的走了那条 RPC（夹具接住 = 没落到网关）', archiveCalls === 1, String(archiveCalls))
      // 放行夹具（回失败）：busy 结束、错误可见，再按 Esc 收场。
      archiveHold.release?.()
      archiveHold.release = null
      await page.waitForTimeout(500)
      const afterRelease = await page.evaluate(() => ({
        alert: document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? '',
        disabled: Array.from(document.querySelectorAll('[role="dialog"] .dshOneTree_modalActions button')).map(
          (button) => (button as HTMLButtonElement).disabled,
        ),
      }))
      check.ok('busy 结束：错误行报出来、按钮恢复可点', afterRelease.alert !== '' && afterRelease.disabled.every((value) => !value), JSON.stringify(afterRelease))
      await closeModal(page)
      await page.click('[data-dshone-tree-action="selection-exit"]').catch(() => undefined)
      await page.waitForTimeout(200)

      // ---- ③ 260px 窄宽度：三个最宽的弹窗逐个量溢出与裁切 ----
      await page.setViewportSize({ width: 260, height: 900 })
      await page.waitForTimeout(250)
      const narrowTargets: ReadonlyArray<{ name: string; open: () => Promise<void> }> = [
        { name: '管理分组', open: () => pillAction(page, 'group-manage') },
        { name: '新建标签组', open: async () => {
          await sessionMenuItem(page, fixture.session, 'moveToGroup')
          await page.click('[data-dshone-tree-item="tag:__new"]')
          await page.waitForSelector('[role="dialog"]')
          await page.waitForTimeout(150)
        } },
      ]
      for (const target of narrowTargets) {
        await target.open()
        const facts = await narrowFacts(page)
        check.ok(`260px·${target.name}：量到了对话框`, facts !== null, JSON.stringify(facts))
        if (facts === null) continue
        check.ok(`260px·${target.name}：对话框在视口内`, facts.dialogLeft >= -1 && facts.dialogRight <= facts.viewport + 1, JSON.stringify(facts))
        check.ok(
          `260px·${target.name}：对话框没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
          facts.dialogScrollWidth <= facts.dialogClientWidth + 1,
          `${String(facts.dialogScrollWidth)} / ${String(facts.dialogClientWidth)}`,
        )
        check.ok(
          `260px·${target.name}：页面没有横向溢出`,
          facts.pageScrollWidth <= facts.pageClientWidth + 1,
          `${String(facts.pageScrollWidth)} / ${String(facts.pageClientWidth)}`,
        )
        check.ok(
          `260px·${target.name}：底部按钮行不溢出`,
          facts.actionsScrollWidth <= facts.actionsClientWidth + 1,
          `${String(facts.actionsScrollWidth)} / ${String(facts.actionsClientWidth)}`,
        )
        check.ok(
          `260px·${target.name}：输入框与按钮都在对话框内且没被裁切`,
          facts.controls.length > 0 &&
            facts.controls.every(
              (control) =>
                control.left >= facts.dialogLeft - 1 &&
                control.right <= facts.dialogRight + 1 &&
                control.width > 0 &&
                control.scrollWidth <= control.clientWidth + 1,
            ),
          JSON.stringify(facts.controls),
        )
        await auditModal(page, check, `260px·${target.name}`)
        screenshots.push(await shot(page, `modal-narrow-${target.name === '管理分组' ? 'manage-groups' : 'tag-create'}`))
        await closeModal(page)
      }
      await page.setViewportSize({ width: 380, height: 900 })

      check.eq('弹窗套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      archiveHold.release?.()
      await opened.context.close()
    }
    return screenshots
  },
}
