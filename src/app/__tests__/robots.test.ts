import { describe, expect, it } from 'vitest'
import robots from '../robots'

describe('robots', () => {
  it('allows /submit but still disallows admin/api/auth', () => {
    const result = robots()
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules
    const disallow = ([] as string[]).concat(rule.disallow ?? [])
    expect(disallow).not.toContain('/submit')
    expect(disallow).toEqual(expect.arrayContaining(['/admin', '/api/', '/auth/']))
  })
})
