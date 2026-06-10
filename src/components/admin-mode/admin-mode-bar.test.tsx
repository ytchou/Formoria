// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminModeBar } from './admin-mode-bar'

const setAdminModeAction = vi.fn()
vi.mock('./actions', () => ({ setAdminModeAction: (m: string) => setAdminModeAction(m) }))

const labels = { god: 'God mode', viewer: 'Viewer mode', enter: 'Switch to viewer', exit: 'Exit', banner: 'plain-user view' }

describe('AdminModeBar', () => {
  beforeEach(() => setAdminModeAction.mockReset())

  it('shows god state and switches to viewer', async () => {
    render(<AdminModeBar mode="god" labels={labels} />)
    expect(screen.getByText('God mode')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to viewer' }))
    expect(setAdminModeAction).toHaveBeenCalledWith('viewer')
  })

  it('shows viewer state and exits to god', async () => {
    render(<AdminModeBar mode="viewer" labels={labels} />)
    expect(screen.getByText('Viewer mode')).toBeInTheDocument()
    expect(screen.getByText('plain-user view')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(setAdminModeAction).toHaveBeenCalledWith('god')
  })
})
