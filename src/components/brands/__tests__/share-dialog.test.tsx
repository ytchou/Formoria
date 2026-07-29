// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

vi.mock('@/lib/analytics', () => ({
  trackBrandPageShared: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', src }: { alt?: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} />
  ),
}))

import { ShareDialog } from '../share-dialog'

const share = zh.brandDetail.share
const SLUG = 'test-brand'
const BRAND_NAME = 'Test Brand'
const ABSOLUTE_URL = `http://localhost/brands/${SLUG}`
const HOST = window.location.host

let writeText: ReturnType<typeof vi.fn>
let openSpy: ReturnType<typeof vi.fn>

function renderDialog(props: { categoryLabel?: string | null; brandImageUrl?: string } = {}) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <ShareDialog brandSlug={SLUG} brandName={BRAND_NAME} brandId="b1" {...props} />
    </NextIntlClientProvider>
  )
}

// The body is a `next/dynamic` chunk behind a `loading:` skeleton that already
// renders a real `role="dialog"` (that is the point — the overlay and focus trap
// mount immediately). So waiting on the role alone resolves against the
// skeleton and every synchronous query that follows races the real body. Wait
// for the loaded surface instead: only the skeleton carries `aria-busy`.
// waitFor's 1s default is not a real budget for this: resolving the chunk is a
// module import competing with every other vitest worker for CPU, so under a
// full parallel suite it routinely overruns. The wait is generous; nothing it
// waits for is weakened.
const CHUNK_LOAD_TIMEOUT_MS = 10_000

async function findLoadedDialog() {
  return waitFor(
    () => {
      const loaded = screen
        .getAllByRole('dialog')
        .find((node) => node.getAttribute('aria-busy') !== 'true')
      if (!loaded) throw new Error('dialog body has not mounted yet')
      return loaded
    },
    { timeout: CHUNK_LOAD_TIMEOUT_MS }
  )
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: share.trigger }))
  await findLoadedDialog()
  await screen.findByRole('button', { name: share.copy })
}

// userEvent.setup() installs its own navigator.clipboard stub, so ours has to
// be defined afterwards or it gets clobbered.
function setupUser() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return user
}

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  openSpy = vi.fn()
  vi.stubGlobal('open', openSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ShareDialog', () => {
  it('instagram copies the link before opening instagram', async () => {
    let resolveWrite: () => void = () => {}
    writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )

    const user = setupUser()
    renderDialog()
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: share.instagram }))

    expect(writeText).toHaveBeenCalledWith(ABSOLUTE_URL)
    // Nothing is opened until the clipboard write has actually resolved.
    expect(openSpy).not.toHaveBeenCalled()

    resolveWrite()

    await waitFor(() => expect(openSpy).toHaveBeenCalled())
    expect(openSpy.mock.calls[0]?.[0]).toBe('https://www.instagram.com/')
  })

  it('instagram opens nothing when the clipboard is denied', async () => {
    writeText.mockRejectedValue(new Error('denied'))

    const user = setupUser()
    renderDialog()
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: share.instagram }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(openSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('instagram shows the status message after a successful copy', async () => {
    const user = setupUser()
    renderDialog()
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: share.instagram }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(share.instagramCopied)
    )
  })

  it('copy writes the absolute brand url and swaps the label', async () => {
    const user = setupUser()
    renderDialog()
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: share.copy }))

    expect(writeText).toHaveBeenCalledWith(ABSOLUTE_URL)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: share.copied })).toBeInTheDocument()
    )
  })

  it('channel row offers line threads facebook instagram and not x', async () => {
    const user = setupUser()
    renderDialog()
    await openDialog(user)

    expect(screen.getByRole('button', { name: share.line })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: share.threads })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: share.facebook })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: share.instagram })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'X' })).not.toBeInTheDocument()
  })

  it('preview card appends the category after the host separator', async () => {
    const user = setupUser()
    renderDialog({ categoryLabel: 'Test Category' })
    await openDialog(user)

    expect(screen.getByText(`${HOST} · Test Category`)).toBeInTheDocument()
  })

  it('preview card leaves no dangling separator without a category', async () => {
    const user = setupUser()
    renderDialog()
    await openDialog(user)

    expect(screen.getByText(HOST)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`${HOST}\\s*·`))).not.toBeInTheDocument()
  })

  it('preview card falls back to the brand initial without a hero image', async () => {
    const user = setupUser()
    renderDialog()
    await openDialog(user)

    expect(screen.getByText(Array.from(BRAND_NAME)[0] as string)).toBeInTheDocument()
  })
})
