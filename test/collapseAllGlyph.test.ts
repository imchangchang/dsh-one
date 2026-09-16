/**
 * 「折叠 / 展开全部」那两枚图标的路径数据（#118）。
 *
 * 这条测试守的是一句承诺：**路径是从旧侧栏原样抄过来的，不是重新画的**。官方
 * primitives 没有方框加减号（#118 的举证与取法写在
 * `src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts` 的文件头），所以装配件里
 * 这两枚只能自备数据；自备之后最怕的就是有人「顺手描一条新的」——观感会与旧侧栏、
 * 与官方图标粗细对不上，而且没人看得出来。这里拿两份数据逐字比对，谁改了其中一份
 * 都会红。
 *
 * 比对对象是 `src/ui/shared/icons.ts` 的 `boxedMinus` / `boxedPlus`（旧侧栏那两枚，
 * 顶栏同一个按钮、同一套语义）。它只**在测试里**被读：插件代码不 import 它（避免把
 * 整份退役图标表拉进装配件的 bundle），两边靠这条测试锁住一致性。
 *
 * 另核一条装配实验室依赖的形态约束：这个数据模块**不能有 import**——实验室套件跑在
 * node 里，react 与官方 primitives 在那边都解析不到，加了 import 会让 `verify:lab`
 * 整个起不来，而不是红一条断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import {
  COLLAPSE_ALL_BOX,
  COLLAPSE_ALL_GLYPHS,
  COLLAPSE_ALL_MINUS,
  COLLAPSE_ALL_PLUS,
} from '../src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts'
import { PANEL_ICONS } from '../src/ui/shared/icons.ts'

test('collapseAllGlyph：两条路径逐字取自旧侧栏的 boxedMinus / boxedPlus', () => {
  assert.deepEqual(COLLAPSE_ALL_GLYPHS.minus, PANEL_ICONS.boxedMinus.paths)
  assert.deepEqual(COLLAPSE_ALL_GLYPHS.plus, PANEL_ICONS.boxedPlus.paths)
  // 三份具名常量就是那两条路径本身（别让具名导出与表里的值漂开）。
  assert.equal(COLLAPSE_ALL_BOX, PANEL_ICONS.boxedMinus.paths[0])
  assert.equal(COLLAPSE_ALL_MINUS, PANEL_ICONS.boxedMinus.paths[1])
  assert.equal(COLLAPSE_ALL_PLUS, PANEL_ICONS.boxedPlus.paths[1])
})

test('collapseAllGlyph：方框那一笔两态共用，中间那一笔两态不同', () => {
  const [boxOfMinus, glyphOfMinus] = COLLAPSE_ALL_GLYPHS.minus
  const [boxOfPlus, glyphOfPlus] = COLLAPSE_ALL_GLYPHS.plus
  assert.equal(boxOfMinus, boxOfPlus)
  assert.notEqual(glyphOfMinus, glyphOfPlus)
  // 两枚都是「方框 + 中间一笔」两条路径，顺序即绘制顺序。
  assert.equal(COLLAPSE_ALL_GLYPHS.minus.length, 2)
  assert.equal(COLLAPSE_ALL_GLYPHS.plus.length, 2)
})

test('collapseAllGlyph：数据模块零 import（装配实验室要在 node 里直接 import 它）', async () => {
  const source = await fsp.readFile('src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts', 'utf8')
  const imports = source.match(/^\s*import\b/gm) ?? []
  assert.deepEqual(imports, [], `collapseAllGlyph.ts 不该有 import，找到 ${String(imports.length)} 处`)
})
