// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

vi.mock('@/lib/analytics', () => ({
  trackBrandReported: vi.fn(),
}))

vi.mock('@/app/[locale]/(site)/brands/[slug]/actions', () => ({
  submitReportAction: vi.fn(),
  submitEvidenceAction: vi.fn(),
}))

vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands/test-brand',
}))

import { Dialog } from '@/components/ui/dialog'
import { DialogLoadingContent } from '../dialog-loading-content'
import { EvidenceDialog } from '../evidence-dialog'
import { EvidenceDialogContent } from '../evidence-dialog-content'
import { ReportDialog } from '../report-dialog'
import { useUser } from '@/lib/auth/use-user'
import { submitEvidenceAction } from '@/app/[locale]/(site)/brands/[slug]/actions'

const evidence = zh.brandDetail.evidence
const report = zh.brandDetail.report

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

// Both bodies are `next/dynamic` chunks behind a `loading:` skeleton that
// already renders a real `role="dialog"` (that is the point — the overlay and
// focus trap mount immediately). So waiting on the role alone resolves against
// the skeleton and every synchronous query that follows races the real body.
// Wait for the loaded surface instead: only the skeleton carries `aria-busy`.
// waitFor's 1s default is not a real budget for this: resolving the chunk is a
// module import competing with every other vitest worker for CPU, so under a
// full parallel suite it routinely overruns. The wait is generous; nothing it
// waits for is weakened. The per-test budget that must exceed this one lives in
// vitest.config.ts (testTimeout).
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

describe('EvidenceDialog', () => {
  beforeEach(() => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'user-uuid-9' },
      loading: false,
    })
  })

  it('opens its own dialog body from its trigger', async () => {
    const user = userEvent.setup()
    renderWithIntl(<EvidenceDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: new RegExp(evidence.trigger) }))

    await findLoadedDialog()
    expect(await screen.findByText(evidence.title)).toBeInTheDocument()
  })

  // The regression this guards: the report body reaches the evidence dialog by
  // synthetically clicking `[data-evidence-dialog-trigger]`, a trigger that
  // never receives a pointer event. Once both bodies became `next/dynamic`
  // chunks, that click both primes and opens in the same commit — so the
  // handoff has to survive an unresolved chunk.
  it('is reached by the report dialog MIT-dispute handoff', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <>
        <EvidenceDialog brandId="b1" brandSlug="test-brand" />
        <ReportDialog brandId="b1" brandSlug="test-brand" />
      </>
    )

    await user.click(screen.getByRole('button', { name: new RegExp(report.trigger) }))
    await findLoadedDialog()

    await user.click(
      await screen.findByRole('button', { name: new RegExp(report.mitDisputeLink) })
    )

    // A dialog stays mounted across the handoff, and it is the evidence one.
    const evidenceDialog = await waitFor(
      () => {
        const loaded = screen
          .getAllByRole('dialog')
          .find(
            (node) =>
              node.getAttribute('aria-busy') !== 'true' &&
              node.textContent?.includes(evidence.title)
          )
        if (!loaded) throw new Error('evidence dialog body has not mounted yet')
        return loaded
      },
      { timeout: CHUNK_LOAD_TIMEOUT_MS }
    )
    expect(evidenceDialog).toBeDefined()
    expect(within(evidenceDialog).getByText(evidence.title)).toBeInTheDocument()
    expect(within(evidenceDialog).getByText(evidence.description)).toBeInTheDocument()
  })
})

// The four footers this body used to spell by hand are now three
// `DialogStatus` branches (each rendering its own footer) plus one form. The
// branch is only correct if it carries BOTH halves: the message the reader is
// answering, and the exact set of ways out. A status that renders the right
// sentence under the wrong actions is the failure this guards — signed-out
// without its sign-in link is a dead end.
describe('EvidenceDialogContent status branches', () => {
  const mockUser = (value: { user: { id: string } | null; loading: boolean }) => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(value)
  }

  function renderContent() {
    return renderWithIntl(
      <Dialog open>
        <EvidenceDialogContent brandId="b1" brandSlug="test-brand" />
      </Dialog>
    )
  }

  function status() {
    const node = document.querySelector('[data-slot="dialog-status"]')
    if (!node) throw new Error('no DialogStatus branch rendered')
    return node as HTMLElement
  }

  it('renders the auth-loading branch with cancel as its only way out', () => {
    mockUser({ user: null, loading: true })
    renderContent()

    const branch = status()
    expect(within(branch).getByText(evidence.loading)).toBeInTheDocument()
    expect(
      within(branch)
        .getAllByRole('button')
        .map((node) => node.textContent)
    ).toEqual([evidence.cancel])
    expect(within(branch).queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders the signed-out branch with cancel and a sign-in link', () => {
    mockUser({ user: null, loading: false })
    renderContent()

    const branch = status()
    expect(within(branch).getByText(evidence.signInPrompt)).toBeInTheDocument()
    expect(
      within(branch)
        .getAllByRole('button')
        .map((node) => node.textContent)
    ).toEqual([evidence.cancel])
    expect(
      within(branch).getByRole('link', { name: evidence.signIn })
    ).toHaveAttribute('href', expect.stringContaining('/sign-in'))
  })

  it('renders the success branch with close as its only way out', async () => {
    const user = userEvent.setup()
    mockUser({ user: { id: 'user-uuid-9' }, loading: false })
    ;(submitEvidenceAction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    })
    renderContent()

    await user.click(screen.getByRole('radio', { name: evidence.stances.supports }))
    await user.type(
      screen.getByLabelText(new RegExp(evidence.productNameLabel)),
      'Test product'
    )
    await user.click(screen.getByRole('button', { name: evidence.submit }))

    await waitFor(() => {
      expect(screen.getByText(evidence.success)).toBeInTheDocument()
    })
    const branch = status()
    expect(
      within(branch)
        .getAllByRole('button')
        .map((node) => node.textContent)
    ).toEqual([evidence.close])
  })
})

describe('DialogLoadingContent', () => {
  it('renders a labelled, busy dialog surface so the overlay and focus trap exist', () => {
    renderWithIntl(
      <Dialog open>
        <DialogLoadingContent />
      </Dialog>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(zh.common.loading)).toBeInTheDocument()
  })

  // The width is the shell's `size` vocabulary, not a className the skeleton
  // re-derives. A skeleton that is a different width from the body it hands off
  // to is a visible jump at the exact moment the chunk lands.
  it('resolves its width through the size prop, defaulting to form', () => {
    const { rerender } = renderWithIntl(
      <Dialog open>
        <DialogLoadingContent />
      </Dialog>
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'form')

    rerender(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <Dialog open>
          <DialogLoadingContent size="panel" />
        </Dialog>
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'panel')
  })
})
