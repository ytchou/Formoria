import { describe, it, expect, vi, beforeEach } from 'vitest'

const authState = vi.hoisted(() => {
  const state = {
    user: { id: 'admin-1', email: 'admin@formoria.com' },
    isAdmin: true,
    select: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }

  return {
    ...state,
    upsert: vi.fn(() => ({
      select: state.select,
    })),
  }
})

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin: vi.fn(() => authState.isAdmin),
}))

vi.mock('@/lib/services/brands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/brands')>()
  return {
    ...actual,
    parseBrandCSV: vi.fn(),
    generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
    isReservedSlug: vi.fn(() => false),
    findSimilarBrands: vi.fn(),
    brandToInsert: vi.fn((b) => ({ ...b })),
    curatedSubmissionToBrand: vi.fn((b) => ({
      ...b,
      status: 'approved',
      heroImageUrl: null,
      contactEmail: null,
      foundingYear: null,
    })),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: authState.user }, error: null })),
    },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: authState.upsert,
    })),
  })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { parseBrandCSV, findSimilarBrands } = await import('@/lib/services/brands')
const { previewBulkImportAction, executeBulkImportAction } = await import('@/app/admin/actions')

describe('previewBulkImportAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isAdmin = true
    authState.select.mockResolvedValue({ data: [], error: null })
  })

  it('returns error when not admin', async () => {
    authState.isAdmin = false
    const result = await previewBulkImportAction('name,description\ntest,test')
    expect(result?.error).toBeDefined()
  })

  it('returns parse error for empty CSV', async () => {
    vi.mocked(parseBrandCSV).mockReturnValue([])
    const result = await previewBulkImportAction('')
    expect(result?.error).toMatch(/no rows/i)
  })

  it('returns preview rows with status for valid CSV', async () => {
    vi.mocked(parseBrandCSV).mockReturnValue([
      {
        name: 'Taiwan Tea',
        description: 'A wonderful tea brand that meets the minimum length requirement here.',
        category: 'Food',
        productTypes: ['fashion'],
      },
    ])
    vi.mocked(findSimilarBrands).mockResolvedValue([])
    const result = await previewBulkImportAction('name,description,category\n...')
    expect(result?.rows).toHaveLength(1)
    expect(result?.rows[0].status).toBe('valid')
  })

  it('marks row as duplicate when similarity match found', async () => {
    vi.mocked(parseBrandCSV).mockReturnValue([
      {
        name: 'Taiwan Tea',
        description: 'A wonderful tea brand that meets the minimum length requirement here.',
        category: 'Food',
        productTypes: ['fashion'],
      },
    ])
    vi.mocked(findSimilarBrands).mockResolvedValue([
      { inputName: 'Taiwan Tea', brandName: 'Taiwan Tea Co', brandSlug: 'taiwan-tea-co', score: 0.75 },
    ])
    const result = await previewBulkImportAction('...')
    expect(result?.rows[0].status).toBe('duplicate')
    expect(result?.rows[0].reason).toContain('Taiwan Tea Co')
  })
})

describe('executeBulkImportAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isAdmin = true
    authState.select.mockResolvedValue({ data: [], error: null })
  })

  it('returns error when not admin', async () => {
    authState.isAdmin = false
    const result = await executeBulkImportAction([])
    expect(result?.error).toBeDefined()
  })

  it('returns empty results for empty selection', async () => {
    const result = await executeBulkImportAction([])
    expect(result?.results).toHaveLength(0)
  })
})
