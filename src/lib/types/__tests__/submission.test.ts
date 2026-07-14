import { describe, it, expect } from 'vitest'
import {
  DENIAL_REASONS,
} from '../submission'

describe('DenialReason', () => {
  it('has exactly 6 preset reasons', () => {
    expect(DENIAL_REASONS).toHaveLength(6)
    expect(DENIAL_REASONS).toContain('not_mit')
    expect(DENIAL_REASONS).toContain('insufficient_info')
    expect(DENIAL_REASONS).toContain('duplicate')
    expect(DENIAL_REASONS).toContain('policy_violation')
    expect(DENIAL_REASONS).toContain('admin_reject')
    expect(DENIAL_REASONS).toContain('other')
  })
})
