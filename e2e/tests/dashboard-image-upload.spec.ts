import { test, expect } from '../fixtures/auth'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensureOwnedBrand } from '../helpers/owned-brand'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

// Minimal 1×1 transparent PNG (67 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('Dashboard — brand image upload', () => {
  let supabase: AnySupabaseClient
  let brandId: string
  let brandSlug: string
  let ownerUserId: string
  let originalDraftData: unknown

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers()
    if (usersError)
      throw new Error(`Failed to list users: ${usersError.message}`)
    const testUser = usersData.users.find(
      (u) => u.email === process.env.E2E_USER_EMAIL,
    )
    if (!testUser)
      throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`)
    ownerUserId = testUser.id

    const brand = await ensureOwnedBrand(supabase, ownerUserId)
    brandId = brand.id
    brandSlug = brand.slug
    originalDraftData = brand.draftData
  })

  test.afterAll(async () => {
    if (!supabase) return
    if (brandId) {
      // This suite has one save journey for its brand, so it cannot hit the
      // unique-pending-per-brand constraint across tests; cleanup still removes queued edits.
      await supabase.from('moderation_flags').delete().eq('brand_id', brandId)
      await supabase
        .from('pending_brand_edits')
        .delete()
        .eq('brand_id', brandId)
      await supabase
        .from('brands')
        .update({ draft_data: originalDraftData })
        .eq('id', brandId)
    }
  })

  test('owner can upload hero and product images and persist both in a draft', async ({
    userPage,
  }) => {
    test.setTimeout(120_000)

    // Image upload is in the Media section — step 1 of the wizard.
    // Navigate directly to ?step=1 so the MediaSection (heroImageUrl) is visible.
    const editPath = `/dashboard/brands/${brandSlug}/edit?step=1`
    const editResp = await userPage.goto(editPath, { timeout: 60_000 })
    if (editResp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.')
      return
    }

    // Confirm the form loaded
    await expect(
      userPage.getByRole('heading', { level: 1, name: /edit|編輯/i }),
    ).toBeVisible({ timeout: 60_000 })

    const heroInput = userPage.locator('#image-upload-heroImageUrl')

    // Intercept the upload API call BEFORE triggering the file-select
    const uploadResponsePromise = userPage.waitForResponse(
      (resp) =>
        resp.url().includes('/api/upload') &&
        resp.request().method() === 'POST',
      { timeout: 20_000 },
    )

    // Attach the tiny PNG buffer as a File via setInputFiles (works on sr-only inputs)
    await heroInput.setInputFiles({
      name: 'test-hero.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    // Wait for the upload API to respond
    const uploadResponse = await uploadResponsePromise
    expect(uploadResponse.status()).toBe(200)
    const uploadBody = await uploadResponse.json()
    expect(uploadBody).toHaveProperty('url')
    const uploadedUrl: string = uploadBody.url
    expect(uploadedUrl).toBeTruthy()

    // The shared uploader is controlled by the form value. A successful upload
    // renders the preview and switches the dropzone to replacement mode.
    await expect(
      userPage.locator('#image-upload-heroImageUrl-replace'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      userPage.locator('#image-upload-heroImageUrl-dropzone').locator('..').getByRole('img'),
    ).toBeVisible({ timeout: 10_000 })

    const productInput = userPage.locator('#productPhotos-upload')
    const productUploadResponsePromise = userPage.waitForResponse(
      (resp) =>
        resp.url().includes('/api/upload') &&
        resp.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await productInput.setInputFiles({
      name: 'test-product.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })
    const productUploadResponse = await productUploadResponsePromise
    expect(productUploadResponse.status()).toBe(200)
    const productUploadBody = await productUploadResponse.json()
    const productUrl: string = productUploadBody.url
    await expect(
      userPage.locator('#productPhotos-upload-dropzone').locator('..').getByRole('img'),
    ).toBeVisible()

    // Save & Continue at step 1 — wizard button (not the old single-form "儲存變更").
    // saveSectionDraftAction persists heroImageUrl to pending_brand_edits and navigates to step 2.
    await userPage.getByRole('button', { name: '儲存並繼續' }).click()
    await expect(userPage).toHaveURL(/\?step=2/, { timeout: 15_000 })

    const { data: brandDraft } = await supabase
      .from('brands')
      .select('draft_data')
      .eq('id', brandId)
      .single()

    const draft = brandDraft?.draft_data as Record<string, unknown>
    expect(draft?.heroImageUrl).toBe(uploadedUrl)
    expect(draft?.productPhotos).toContain(productUrl)
  })
})
