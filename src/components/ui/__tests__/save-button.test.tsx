// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zhMessages from '../../../../messages/zh-TW.json'
import {
  PENDING_SAVE_STORAGE_KEY,
  serializePendingSave,
} from '@/lib/auth/pending-save'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toggle: vi.fn(),
  toastSuccess: vi.fn(),
  viewer: {
    user: null as { id: string } | null,
    loading: false,
  },
  saves: {
    savedIds: new Set<string>(),
    loading: false,
  },
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands/mountain-goods',
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: () => ({
    savedIds: mocks.saves.savedIds,
    loading: mocks.saves.loading,
    toggle: mocks.toggle,
  }),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({
    user: mocks.viewer.user,
    loading: mocks.viewer.loading,
    viewer: { user: mocks.viewer.user, isAdmin: false },
    viewerLoading: mocks.viewer.loading,
    viewerError: false,
    refreshViewer: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess },
}))

import { SaveButton } from '@/components/ui/save-button'

function Subject() {
  return (
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <SaveButton id="brand-1" slug="mountain-goods" variant="inline" />
    </NextIntlClientProvider>
  )
}

const SAVE_NAME = zhMessages.saveBrand.saveAriaLabel
const PROMPT = zhMessages.saveBrand.signInPrompt

beforeEach(() => {
  mocks.viewer.user = null
  mocks.viewer.loading = false
  mocks.saves.savedIds = new Set()
  mocks.saves.loading = false
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SaveButton, signed out', () => {
  it('is enabled while the viewer is still loading', () => {
    mocks.viewer.loading = true
    render(<Subject />)

    const save = screen.getByRole('button', { name: SAVE_NAME })
    expect(save).toBeEnabled()
    expect(save).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('queues a click made while loading and opens the prompt once the viewer resolves signed out', async () => {
    mocks.viewer.loading = true
    const { rerender } = render(<Subject />)

    fireEvent.click(screen.getByRole('button', { name: SAVE_NAME }))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    mocks.viewer.loading = false
    rerender(<Subject />)

    expect(
      await screen.findByRole('alertdialog', { name: PROMPT })
    ).toBeInTheDocument()
  })

  it('opens a dialog that gives the reason, and does not navigate', async () => {
    render(<Subject />)

    fireEvent.click(screen.getByRole('button', { name: SAVE_NAME }))

    expect(
      await screen.findByRole('alertdialog', { name: PROMPT })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: zhMessages.saveBrand.signInPromptConfirm,
      })
    ).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('closes on the dismiss action without writing a pending save', async () => {
    render(<Subject />)
    const save = screen.getByRole('button', { name: SAVE_NAME })

    fireEvent.click(save)
    await screen.findByRole('alertdialog', { name: PROMPT })
    fireEvent.click(
      screen.getByRole('button', {
        name: zhMessages.saveBrand.signInPromptDismiss,
      })
    )

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    await waitFor(() => {
      expect(save).toHaveFocus()
    })
    expect(window.sessionStorage.getItem(PENDING_SAVE_STORAGE_KEY)).toBeNull()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('sign in records the pending save and the return path, then goes to sign-in with the reason', async () => {
    render(<Subject />)

    fireEvent.click(screen.getByRole('button', { name: SAVE_NAME }))
    await screen.findByRole('alertdialog', { name: PROMPT })
    fireEvent.click(
      screen.getByRole('button', {
        name: zhMessages.saveBrand.signInPromptConfirm,
      })
    )

    expect(mocks.push).toHaveBeenCalledWith('/auth/sign-in?reason=save')
    expect(document.cookie).toContain(
      `post_auth_next=${encodeURIComponent('/brands/mountain-goods')}`
    )
    expect(
      JSON.parse(window.sessionStorage.getItem(PENDING_SAVE_STORAGE_KEY) ?? '{}')
    ).toMatchObject({ kind: 'brand', id: 'brand-1' })
    expect(mocks.toggle).not.toHaveBeenCalled()
  })
})

describe('SaveButton, returning signed in', () => {
  function seedPending(kind: 'brand' | 'product', id: string) {
    window.sessionStorage.setItem(
      PENDING_SAVE_STORAGE_KEY,
      serializePendingSave(kind, id, Date.now())
    )
  }

  it('applies the pending save once and confirms with a toast', async () => {
    seedPending('brand', 'brand-1')
    mocks.viewer.user = { id: 'user-1' }
    render(<Subject />)

    await waitFor(() => {
      expect(mocks.toggle).toHaveBeenCalledWith('brand-1')
    })
    expect(mocks.toggle).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      zhMessages.saveBrand.savedToast
    )
    expect(window.sessionStorage.getItem(PENDING_SAVE_STORAGE_KEY)).toBeNull()
  })

  it('does not toggle an item that is already saved', async () => {
    seedPending('brand', 'brand-1')
    mocks.viewer.user = { id: 'user-1' }
    mocks.saves.savedIds = new Set(['brand-1'])
    render(<Subject />)

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalled()
    })
    expect(mocks.toggle).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(PENDING_SAVE_STORAGE_KEY)).toBeNull()
  })

  it('ignores a pending save for a different item', () => {
    seedPending('product', 'brand-1')
    mocks.viewer.user = { id: 'user-1' }
    render(<Subject />)

    expect(mocks.toggle).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(PENDING_SAVE_STORAGE_KEY)).not.toBeNull()
  })

  it('waits for the saved set of the new viewer before applying', () => {
    seedPending('brand', 'brand-1')
    const { rerender } = render(<Subject />)

    // The commit where the viewer resolves still carries the signed-out saved
    // set: an already-saved brand would read as unsaved here.
    mocks.viewer.user = { id: 'user-1' }
    rerender(<Subject />)
    expect(mocks.toggle).not.toHaveBeenCalled()

    mocks.saves.loading = true
    rerender(<Subject />)
    expect(mocks.toggle).not.toHaveBeenCalled()

    mocks.saves.savedIds = new Set(['brand-1'])
    mocks.saves.loading = false
    rerender(<Subject />)
    expect(mocks.toggle).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
  })
})
