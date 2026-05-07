import { describe, it, expect } from 'vitest'
import { submissionToDomain, submissionToInsert } from './submissions'

describe('submissionToDomain', () => {
  it('transforms snake_case DB row to camelCase BrandSubmission', () => {
    const dbRow = {
      id: 'sub-1',
      brand_id: null,
      brand_name: 'Cool Brand',
      submitter_email: 'submitter@example.com',
      submitter_name: 'John Doe',
      description: 'A cool brand from Taiwan',
      website_url: 'https://coolbrand.tw',
      social_links: { instagram: '@coolbrand' },
      suggested_tags: ['artisan', 'organic'],
      status: 'pending',
      reviewer_notes: null,
      submitted_at: '2026-01-01T00:00:00Z',
      reviewed_at: null,
      reviewed_by: null,
    }

    const submission = submissionToDomain(dbRow)

    expect(submission.id).toBe('sub-1')
    expect(submission.brandId).toBeNull()
    expect(submission.brandName).toBe('Cool Brand')
    expect(submission.submitterEmail).toBe('submitter@example.com')
    expect(submission.submitterName).toBe('John Doe')
    expect(submission.websiteUrl).toBe('https://coolbrand.tw')
    expect(submission.socialLinks).toEqual({ instagram: '@coolbrand' })
    expect(submission.suggestedTags).toEqual(['artisan', 'organic'])
    expect(submission.status).toBe('pending')
    expect(submission.reviewerNotes).toBeNull()
    expect(submission.reviewedAt).toBeNull()
    expect(submission.reviewedBy).toBeNull()
  })
})

describe('submissionToInsert', () => {
  it('transforms camelCase domain data to snake_case DB row', () => {
    const input = {
      brandName: 'New Brand',
      submitterEmail: 'new@example.com',
      submitterName: 'Jane Doe',
      description: 'Brand description',
      websiteUrl: 'https://newbrand.tw',
      socialLinks: { instagram: '@new' },
      suggestedTags: ['eco-friendly'],
    }

    const row = submissionToInsert(input)

    expect(row.brand_name).toBe('New Brand')
    expect(row.submitter_email).toBe('new@example.com')
    expect(row.submitter_name).toBe('Jane Doe')
    expect(row.website_url).toBe('https://newbrand.tw')
    expect(row.social_links).toEqual({ instagram: '@new' })
    expect(row.suggested_tags).toEqual(['eco-friendly'])
    expect(row).not.toHaveProperty('brandName')
    expect(row).not.toHaveProperty('submitterEmail')
  })
})
