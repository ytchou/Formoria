import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidatePath } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath }))

import { revalidatePublicBrand } from './public-brand-cache'

describe('revalidatePublicBrand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates both locale variants, discovery pages, and the sitemap', () => {
    revalidatePublicBrand({ slug: 'niizo' })

    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        '/brands/niizo',
        '/en/brands/niizo',
        '/',
        '/en',
        '/brands',
        '/en/brands',
        '/sitemap.xml',
      ]),
    )
  })

  it('also invalidates the previous slug after a rename', () => {
    revalidatePublicBrand({
      slug: 'niizo-studio',
      previousSlug: 'niizo',
    })

    expect(revalidatePath).toHaveBeenCalledWith('/brands/niizo')
    expect(revalidatePath).toHaveBeenCalledWith('/en/brands/niizo')
  })
})
