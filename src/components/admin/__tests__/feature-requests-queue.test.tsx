// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import messages from '../../../../messages/en.json'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

import {
  FeatureRequestsQueue,
  type FeatureRequestQueueItem,
} from '../feature-requests-queue'

const copy = messages.admin.featureRequests
// The admin catalogue has no per-code strings, so the queue reuses these.
const errorCopy = messages.feedback.submit.errors

const OPEN_REQUEST: FeatureRequestQueueItem = {
  id: '1a2b3c4d-1111-4aaa-8bbb-0123456789ab',
  title: 'Let owners schedule a launch date',
  status: 'open',
  voteCount: 12,
  adminNote: null,
  mergedIntoId: null,
}

const MERGED_REQUEST: FeatureRequestQueueItem = {
  id: '1a2b3c4d-2222-4aaa-8bbb-0123456789ab',
  title: 'Schedule a launch date',
  status: 'duplicate',
  voteCount: 0,
  adminNote: null,
  mergedIntoId: OPEN_REQUEST.id,
}

const OTHER_REQUEST: FeatureRequestQueueItem = {
  id: '1a2b3c4d-3333-4aaa-8bbb-0123456789ab',
  title: 'Let owners pin a founding story',
  status: 'open',
  voteCount: 3,
  adminNote: null,
  mergedIntoId: null,
}

function renderQueue(
  overrides: {
    setStatusAction?: () => Promise<{ error?: string } | undefined>
    mergeAction?: () => Promise<{ error?: string } | undefined>
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FeatureRequestsQueue
        requests={[OPEN_REQUEST, MERGED_REQUEST, OTHER_REQUEST]}
        setStatusAction={overrides.setStatusAction ?? vi.fn()}
        mergeAction={overrides.mergeAction ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  )
}

// Every row's merge <select> lists all requests, so a bare getByText(title)
// matches the <option>s too. The title cell is the only <span> carrying it.
function titleCell(title: string): HTMLElement {
  return screen.getByText(title, { selector: 'span' })
}

function rowFor(title: string): HTMLElement {
  const cell = titleCell(title)
  const row = cell.closest('tr')
  if (!row) throw new Error(`expected a row for ${title}`)
  return row
}

describe('FeatureRequestsQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every request including merged ones', () => {
    renderQueue()

    expect(titleCell(OPEN_REQUEST.title)).toBeInTheDocument()
    expect(titleCell(MERGED_REQUEST.title)).toBeInTheDocument()
    expect(
      within(rowFor(MERGED_REQUEST.title)).getByText(copy.mergedInto),
    ).toBeInTheDocument()
  })

  it('offers only the statuses an admin may set by hand', () => {
    renderQueue()

    const select = within(rowFor(OPEN_REQUEST.title)).getByLabelText(
      copy.statusLabel.replace('{title}', OPEN_REQUEST.title),
    )

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['open', 'planned', 'in_progress', 'shipped', 'declined'])
  })

  it('shows a merged row its duplicate status without offering it', () => {
    renderQueue()

    const select = within(rowFor(MERGED_REQUEST.title)).getByLabelText(
      copy.statusLabel.replace('{title}', MERGED_REQUEST.title),
    )

    expect((select as HTMLSelectElement).value).toBe('duplicate')
    expect(
      within(select).getByRole('option', { name: copy.status.duplicate }),
    ).toBeDisabled()
  })

  it('never offers a merged tombstone as a merge target', () => {
    renderQueue()

    const select = within(rowFor(OPEN_REQUEST.title)).getByLabelText(
      copy.mergeLabel.replace('{title}', OPEN_REQUEST.title),
    )

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['', OPEN_REQUEST.id, OTHER_REQUEST.id])
  })

  it('disables merge when source and target are the same', async () => {
    const user = userEvent.setup()
    const mergeAction = vi.fn().mockResolvedValue(undefined)
    renderQueue({ mergeAction })

    const row = rowFor(OPEN_REQUEST.title)
    const mergeButton = within(row).getByRole('button', {
      name: copy.mergeAction,
    })
    expect(mergeButton).toBeDisabled()

    const select = within(row).getByLabelText(
      copy.mergeLabel.replace('{title}', OPEN_REQUEST.title),
    )

    await user.selectOptions(select, OPEN_REQUEST.id)
    expect(mergeButton).toBeDisabled()

    await user.selectOptions(select, OTHER_REQUEST.id)
    expect(mergeButton).toBeEnabled()
    expect(mergeAction).not.toHaveBeenCalled()
  })

  it('surfaces the merge result', async () => {
    const user = userEvent.setup()
    const mergeAction = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderQueue({ mergeAction })

    let row = rowFor(OPEN_REQUEST.title)
    await user.selectOptions(
      within(row).getByLabelText(
        copy.mergeLabel.replace('{title}', OPEN_REQUEST.title),
      ),
      OTHER_REQUEST.id,
    )
    await user.click(within(row).getByRole('button', { name: copy.mergeAction }))

    await waitFor(() =>
      expect(mergeAction).toHaveBeenCalledWith(
        OPEN_REQUEST.id,
        OTHER_REQUEST.id,
      ),
    )
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(copy.toast.merged),
    )

    unmount()
    vi.clearAllMocks()

    const failing = vi.fn().mockResolvedValue({ error: 'invalid_target' })
    renderQueue({ mergeAction: failing })
    row = rowFor(OPEN_REQUEST.title)
    await user.selectOptions(
      within(row).getByLabelText(
        copy.mergeLabel.replace('{title}', OPEN_REQUEST.title),
      ),
      OTHER_REQUEST.id,
    )
    await user.click(within(row).getByRole('button', { name: copy.mergeAction }))

    // The specific code, not the generic toast: an admin retrying an
    // impossible merge forever is the failure this pins.
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(errorCopy.merged),
    )
    expect(mocks.toastError).not.toHaveBeenCalledWith(copy.toast.error)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('falls back to the generic toast for a code with no distinct copy', async () => {
    const user = userEvent.setup()
    const failing = vi.fn().mockResolvedValue({ error: 'database_error' })
    renderQueue({ setStatusAction: failing })

    const row = rowFor(OPEN_REQUEST.title)
    await user.click(within(row).getByRole('button', { name: copy.saveStatus }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(copy.toast.error),
    )
  })
})
