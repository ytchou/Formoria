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

  it('renders Chinese content for zh-TW locale', async () => {
    const email = await buildEditApprovedEmail({
      brandName: '測試品牌',
      ownerEmail: 'test@example.com',
      locale: 'zh-TW',
    })

    expect(email.subject).toContain('已通過審核')
    expect(email.subject).toContain('— Formoria')
    expect(email.html).not.toContain('Your edits for')
    expect(email.html).not.toContain('前往 Formoria / Visit Formoria')
  })

  it('renders English content for en locale', async () => {
    const email = await buildEditApprovedEmail({
      brandName: 'TestBrand',
      ownerEmail: 'test@example.com',
      locale: 'en',
    })

    expect(email.subject).toContain('approved')
    expect(email.subject).toContain('— Formoria')
    expect(email.html).not.toContain('已通過審核')
    expect(email.html).not.toContain('前往 Formoria / Visit Formoria')
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

  it('renders Chinese content for zh-TW locale', async () => {
    const email = await buildEditRejectedEmail({
      brandName: '測試品牌',
      ownerEmail: 'test@example.com',
      notes: '說明不足',
      locale: 'zh-TW',
    })

    expect(email.subject).toContain('未通過審核')
    expect(email.subject).toContain('— Formoria')
    expect(email.html).toContain('說明不足')
    expect(email.html).not.toContain('After review')
    expect(email.html).not.toContain('審核意見 / Reviewer notes:')
  })

  it('renders English content for en locale', async () => {
    const email = await buildEditRejectedEmail({
      brandName: 'TestBrand',
      ownerEmail: 'test@example.com',
      notes: 'Insufficient detail',
      locale: 'en',
    })

    expect(email.subject).toContain('not approved')
    expect(email.subject).toContain('— Formoria')
    expect(email.html).toContain('Insufficient detail')
    expect(email.html).not.toContain('未通過審核')
    expect(email.html).not.toContain('審核意見 / Reviewer notes:')
  })

  it('defaults to zh-TW when locale is omitted', async () => {
    const email = await buildEditRejectedEmail({
      brandName: '測試品牌',
      ownerEmail: 'test@example.com',
    })

    expect(email.subject).toContain('未通過審核')
  })
})
