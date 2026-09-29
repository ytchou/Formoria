import { expect, it } from 'vitest'
import { buildV3Dataset, approvalSourceFromAgreement } from '../label-build-dataset'
import type { DatasetV2Item } from '../dataset-v2'

it('retains original query grades and splits while adding judged discovery queries', () => {
  const original: DatasetV2Item[] = [{
    id: 'tea-gift', query: '送茶具給朋友', queryType: 'subjective', split: 'holdout',
    expected: [{ brandSlug: 'teaware-taiwan', productKey: 'pot', grade: 2 }],
  }]
  const v3 = buildV3Dataset(original, [
    { id: 'brand-marcia', query: '瑪西亞工坊', queryType: 'brand_name' },
  ], [
    { queryId: 'brand-marcia', brandSlug: 'marcia-studio', productKey: 'canvas-tote', grade: 3 },
  ], [60, 20, 20], 1900)
  expect(v3[0]).toEqual(original[0])
  expect(v3[1]).toMatchObject({
    id: 'brand-marcia', query: '瑪西亞工坊', queryType: 'brand_name',
    expected: [{ brandSlug: 'marcia-studio', productKey: 'canvas-tote', grade: 3 }],
  })
  expect(['train', 'val', 'holdout']).toContain(v3[1]!.split)
})

it('records a blind LLM panel as the reviewer when its agreement clears the gate', () => {
  expect(approvalSourceFromAgreement({ kappa_w: 0.955, reviewer: 'blind-llm-panel' })).toBe('blind-llm-panel')
  expect(approvalSourceFromAgreement({ kappa_w: 0.4, reviewer: 'blind-llm-panel' })).toBeUndefined()
})
