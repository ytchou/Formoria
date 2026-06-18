import { describe, it, expect } from 'vitest'
import { buildEditApprovedEmail } from '@emails/templates/edit-approved'
import { buildEditRejectedEmail } from '@emails/templates/edit-rejected'

describe('buildEditApprovedEmail', () => {
  it('returns branded edit approval', async () => {
    const email = await buildEditApprovedEmail('Test Brand', 'owner@example.com')
    expect(email.to).toBe('owner@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('Formoria')
    expect(email.html).toContain('Made in Taiwan')
    expect(email.html).not.toContain('<script>')
  })
})

describe('buildEditRejectedEmail', () => {
  it('returns branded edit rejection with notes', async () => {
    const email = await buildEditRejectedEmail('Test Brand', 'owner@example.com', 'Inaccurate info')
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Inaccurate info')
    expect(email.html).toContain('Formoria')
  })

  it('handles missing notes', async () => {
    const email = await buildEditRejectedEmail('Test Brand', 'owner@example.com')
    expect(email.to).toBe('owner@example.com')
    expect(email.html).not.toContain('undefined')
  })
})
