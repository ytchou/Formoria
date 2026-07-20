import { it, expect, afterAll } from 'vitest'
import { describeWithDb } from '@/test/setup'
import {
  listMarketingItems,
  createMarketingItem,
  updateMarketingItem,
  deleteMarketingItem,
} from '../marketing-calendar'

const TEST_ID = `test-${Date.now()}-integration-item`

describeWithDb('marketing calendar service (integration)', () => {
  afterAll(async () => {
    await deleteMarketingItem(TEST_ID).catch(() => {})
  })

  it('creates an item with camelCase fields transformed to snake_case', async () => {
    const item = await createMarketingItem({
      id: TEST_ID,
      title: 'Integration test item',
      type: 'idea',
      status: 'brief',
      priority: 'high',
      targetDate: '2099-12-01',
      platforms: ['threads', 'ig'],
      media: 'carousel',
      lang: 'en',
      sourceType: 'trend',
      sourceDetectedBy: 'integration-test',
      sourceDetectedAt: '2099-11-30',
      sourceUrl: 'https://example.com/source',
      briefPath: 'marketing/briefs/integration-test.md',
      outputPath: 'marketing/output/integration-test.md',
      todoistTaskId: 'todoist-integration-test',
      notes: 'Created by the marketing calendar integration test',
    })

    expect(item).toMatchObject({
      id: TEST_ID,
      title: 'Integration test item',
      type: 'idea',
      status: 'brief',
      priority: 'high',
      targetDate: '2099-12-01',
      platforms: ['threads', 'ig'],
      media: 'carousel',
      lang: 'en',
      sourceType: 'trend',
      sourceDetectedBy: 'integration-test',
      sourceDetectedAt: '2099-11-30',
      sourceUrl: 'https://example.com/source',
      briefPath: 'marketing/briefs/integration-test.md',
      outputPath: 'marketing/output/integration-test.md',
      todoistTaskId: 'todoist-integration-test',
      notes: 'Created by the marketing calendar integration test',
    })
    expect(item.createdAt).toBeTruthy()
    expect(item.updatedAt).toBeTruthy()
  })

  it('lists seed items and the test item', async () => {
    const items = await listMarketingItems()

    expect(items.length).toBeGreaterThanOrEqual(5)
    expect(items.some((item) => item.id === TEST_ID)).toBe(true)
  })

  it('updates status and bumps updatedAt', async () => {
    const before = (await listMarketingItems()).find((item) => item.id === TEST_ID)
    expect(before).toBeDefined()

    const updated = await updateMarketingItem(TEST_ID, { status: 'scheduled' })

    expect(updated?.status).toBe('scheduled')
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(
      new Date(before!.updatedAt).getTime()
    )
  })

  it('deletes the item and verifies it is gone', async () => {
    await expect(deleteMarketingItem(TEST_ID)).resolves.toEqual({ deleted: true })

    const items = await listMarketingItems()
    expect(items.some((item) => item.id === TEST_ID)).toBe(false)
  })

  it('rejects an invalid status via the database constraint', async () => {
    await expect(
      createMarketingItem({
        id: `${TEST_ID}-invalid-status`,
        title: 'Invalid status item',
        type: 'idea',
        status: 'invalid-status',
      })
    ).rejects.toThrow()
  })

  it('returns null when updating a non-existent item', async () => {
    await expect(
      updateMarketingItem(`${TEST_ID}-missing`, { status: 'brief' })
    ).resolves.toBeNull()
  })

  it('returns deleted false when deleting a non-existent item', async () => {
    await expect(deleteMarketingItem(`${TEST_ID}-missing`)).resolves.toEqual({
      deleted: false,
    })
  })
})
