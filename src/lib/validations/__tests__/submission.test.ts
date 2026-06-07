import { describe, expect, it } from 'vitest'
import { descriptionField } from '../submission'

describe('descriptionField min length', () => {
  it('rejects descriptions shorter than 40 characters', () => {
    expect(descriptionField.safeParse('x'.repeat(39)).success).toBe(false)
  })
  it('accepts descriptions of 40+ characters', () => {
    expect(descriptionField.safeParse('x'.repeat(40)).success).toBe(true)
  })
})
