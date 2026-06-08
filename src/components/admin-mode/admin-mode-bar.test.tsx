// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminModeBar } from './admin-mode-bar'

const setAdminModeAction = vi.fn()
vi.mock('./actions', () => ({ setAdminModeAction: (m: string) => setAdminModeAction(m) }))

const labels = { god: 'God mode', viewer: 'Viewer mode', enter: 'Switch to viewer', exit: 'Exit', banner: 'plain-user view' }
const setCookie = (v?: string) => Object.defineProperty(document, 'cookie', { writable: true, value: v ? `fm_mode=${v}` : '' })

describe('AdminModeBar', () => {
  beforeEach(() => setAdminModeAction.mockReset())

  it('renders nothing without an fm_mode cookie', () => {
    setCookie(undefined)
    const { container } = render(<AdminModeBar labels={labels} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows god state and switches to viewer', async () => {
    setCookie('god')
    render(<AdminModeBar labels={labels} />)
    expect(screen.getByText('God mode')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to viewer' }))
    expect(setAdminModeAction).toHaveBeenCalledWith('viewer')
  })

  it('shows viewer state and exits to god', async () => {
    setCookie('viewer')
    render(<AdminModeBar labels={labels} />)
    expect(screen.getByText('Viewer mode')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(setAdminModeAction).toHaveBeenCalledWith('god')
  })
})
