/**
 * 插件可移植性（#83）：三个 `dsh-*` 插件（git 卡片 / 右键菜单 / 清空件）不得再依赖
 * 自有 shell frame，装配清单里的 id 必须已是 `dsh-*`，旧 `vscode-*` id 不得有残留。
 *
 * 为什么扫源码而不是 import 进来跑：这三个插件运行时依赖 react / 官方私有包
 * （`@deepseek-ai/dsh-client-ui-primitives` 等），单测环境 import 不进来——与
 * pluginLocales.test.ts / assemblyShellContract.test.ts 同一取舍。
 *
 * 为什么这条断言重要：官方 web 里**没有** `[data-shell="dsh-one"]` 这个元素，
 * 插件只要还按它取挂载点就会静默不工作（真运行才看得见）。浏览器验证套件里另有一条
 * 真运行断言（把 frame 标记从页面上抹掉再操作，见 test/assembly-lab 的 F-06）；
 * 这里钉的是源码级契约，改坏了在 `npm test` 就红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  COMPOSER_CLEAR_PLUGIN_ID,
  CONTEXT_MENU_PLUGIN_ID,
  GIT_CARD_PLUGIN_ID,
} from '../src/ui/assembly/wireFilter.ts'

const ROOT = path.join(import.meta.dirname, '..')
const SHELL_DIR = path.join(ROOT, 'src', 'ui', 'assembly', 'shell')

/** 三个已迁移的插件（#83）：文件 → 该件在装配清单里的 id。 */
const PORTABLE_PLUGINS: ReadonlyArray<{ file: string; id: string }> = [
  { file: 'gitCardPlugin.ts', id: GIT_CARD_PLUGIN_ID },
  { file: 'contextMenuPlugin.ts', id: CONTEXT_MENU_PLUGIN_ID },
  { file: 'composerClearPlugin.ts', id: COMPOSER_CLEAR_PLUGIN_ID },
]

/** 挂载点共享模块（三个插件共用的那一个）。 */
const MOUNT_POINTS = 'mountPoints.ts'

const read = (file: string): string => fs.readFileSync(path.join(SHELL_DIR, file), 'utf8')

/**
 * 只留代码行：源码头里的解释会**引用**旧标记来讲「为什么改」，那是文档不是依赖。
 */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
}

test('#83：三个 dsh-* 插件的代码里不出现自有 frame 标记（挂载点已脱离我们 frame）', () => {
  const markers = ['data-shell', 'dshOneShell', 'dshOneSidebarShell', 'dshOneSettingsShell']
  for (const plugin of [...PORTABLE_PLUGINS.map((p) => p.file), MOUNT_POINTS]) {
    const code = codeOnly(read(plugin))
    for (const marker of markers) {
      assert.ok(!code.includes(marker), `${plugin} 的代码不得再依赖自有标记 ${marker}（官方 web 里没有它）`)
    }
  }
})

test('#83：三个插件经共享的挂载点模块取容器，且不再自带 frameRoot', () => {
  for (const plugin of PORTABLE_PLUGINS) {
    const code = codeOnly(read(plugin.file))
    assert.match(code, /from '\.\/mountPoints\.ts'/, `${plugin.file} 必须用挂载点模块（不得自己找容器）`)
    assert.ok(!/frameRoot/.test(code), `${plugin.file} 不得再有 frameRoot（那是自有 frame 时代的取法）`)
  }
})

test('#83：挂载点取的是官方语义属性（对话区容器 + composer 座位）', () => {
  const code = read(MOUNT_POINTS)
  // 官方 ui-conversation 写、官方 ui-chat 也按它取滚动体（出处见该文件头）。
  assert.match(code, /CONVERSATION_SCROLL_SELECTOR = '\[data-conversation-scroll\]'/)
  // 官方槽位渲染出的语义属性（语言无关、非 css-module 哈希）。
  assert.match(code, /COMPOSER_SEAT_SELECTOR = '\[data-slot="conversation\.composer\.bar"\]'/)
})

test('#83：三个插件的装配 id 都已是 dsh-*（改名生效）', () => {
  for (const plugin of PORTABLE_PLUGINS) {
    assert.match(plugin.id, /^@dsh-one\/dsh-/, `装配清单里的 id 还是旧命名：${plugin.id}`)
  }
  // 插件的 CSS 标记（页面上按它查样式是否装上）也要跟着改名——F-01 契约套件按
  // dataset.plugin 断言「该树的自有插件真的执行过」，漏改就查不到。
  for (const plugin of PORTABLE_PLUGINS) {
    const code = read(plugin.file)
    assert.ok(code.includes(`tag.dataset.plugin = '${plugin.id}'`), `${plugin.file} 的 CSS 标记必须是 ${plugin.id}`)
  }
})

test('#83：旧 id 在仓库里零残留（issue 历史与测试构造除外）', () => {
  const suffixes = ['git-card', 'context-menu', 'composer-clear']
  const oldIds = suffixes.map((suffix) => `@dsh-one/vscode-${suffix}`)
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'out', '.worktrees', '.dev-host', '.prototype'])
  const offenders: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory() && skipDirs.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        walk(full)
        continue
      }
      if (!/\.(ts|mjs|js|json|md|html|sh)$/.test(entry.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      for (const oldId of oldIds) {
        if (text.includes(oldId)) offenders.push(`${path.relative(ROOT, full)} → ${oldId}`)
      }
    }
  }
  walk(ROOT)
  assert.deepEqual(offenders, [], `旧 id 仍有残留：\n${offenders.join('\n')}`)
})
