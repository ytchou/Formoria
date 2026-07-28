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

const OPEN_REQUEST: FeatureRequestQueueItem = {
  id: '1a2b3c4d-1111-4aaa-8bbb-0123456789ab',
  title: 'Let owners schedule a launch date',
  category: 'owner',
  status: 'open',
  voteCount: 12,
  adminNote: null,
  mergedIntoId: null,
}

const MERGED_REQUEST: FeatureRequestQueueItem = {
  id: '1a2b3c4d-2222-4aaa-8bbb-0123456789ab',
  title: 'Schedule a launch date',
  category: 'owner',
  status: 'duplicate',
  voteCount: 0,
  adminNote: null,
  mergedIntoId: OPEN_REQUEST.id,
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
        requests={[OPEN_REQUEST, MERGED_REQUEST]}
        setStatusAction={overrides.setStatusAction ?? vi.fn()}
        mergeAction={overrides.mergeAction ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  )
}

function rowFor(title: string): HTMLElement {
  const cell = screen.getByText(title)
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

    expect(screen.getByText(OPEN_REQUEST.title)).toBeInTheDocument()
    expect(screen.getByText(MERGED_REQUEST.title)).toBeInTheDocument()
    expect(
      within(rowFor(MERGED_REQUEST.title)).getByText(copy.mergedInto),
    ).toBeInTheDocument()
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
    const selfOption = within(select).getByRole('option', {
      name: OPEN_REQUEST.title,
    })
    expect(selfOption).toBeDisabled()

    await user.selectOptions(select, MERGED_REQUEST.id)
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
      MERGED_REQUEST.id,
    )
    await user.click(within(row).getByRole('button', { name: copy.mergeAction }))

    await waitFor(() =>
      expect(mergeAction).toHaveBeenCalledWith(
        OPEN_REQUEST.id,
        MERGED_REQUEST.id,
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
      MERGED_REQUEST.id,
    )
    await user.click(within(row).getByRole('button', { name: copy.mergeAction }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(copy.toast.error),
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
