import { test } from 'node:test'
import assert from 'node:assert/strict'
import { questionInteractionStatus } from '../src/pure/chatContract.ts'
import type { PendingQuestion } from '../src/pure/chatContract.ts'

type Question = PendingQuestion['questions'][number]

const planReview = (overrides: Partial<Question> = {}): Question => ({
  question: '计划见详情',
  detail: '# plan',
  intent: { kind: 'plan-review', approve: '同意' },
  options: [{ label: '同意' }, { label: '拒绝' }],
  ...overrides,
})

test('single plan-review question with approve option maps to plan-review', () => {
  assert.equal(questionInteractionStatus([planReview()]), 'plan-review')
})

test('multi-question requests are plain questions', () => {
  assert.equal(questionInteractionStatus([planReview(), planReview()]), 'question')
})

const degradations: Array<[string, Question]> = [
  ['无 intent', planReview({ intent: undefined })],
  ['intent 不是 plan-review', planReview({ intent: { kind: 'other' } })],
  ['缺 detail', planReview({ detail: undefined })],
  ['多选', planReview({ multiSelect: true })],
  ['选项超过 2 个', planReview({ options: [{ label: '同意' }, { label: '拒绝' }, { label: '再说' }] })],
  ['没有选项命中 intent.approve', planReview({ options: [{ label: '好' }, { label: '不' }] })],
  ['无选项', planReview({ options: undefined })],
]
for (const [label, q] of degradations) {
  test(`降级为 question：${label}`, () => {
    assert.equal(questionInteractionStatus([q]), 'question')
  })
}

test('empty questions list is a plain question', () => {
  assert.equal(questionInteractionStatus([]), 'question')
})
