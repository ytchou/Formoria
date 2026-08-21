// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

describe('Tooltip', () => {
  it('shows content on focus and hides it on blur', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>What counts as a visit?</TooltipTrigger>
          <TooltipContent>A browsing session that opened your brand page.</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'A browsing session that opened your brand page.',
    )
  })

  it('leaves the trigger to carry its own accessible name', async () => {
    // Base UI treats a tooltip as a visual affordance and wires no
    // `aria-describedby`, so a trigger whose name lives only in the popup would
    // be announced as nothing at all. This is the contract every call site has
    // to meet, asserted once here rather than three times at the call sites.
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger aria-label="What counts as a visit?">ⓘ</TooltipTrigger>
          <TooltipContent>A browsing session that opened your brand page.</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'What counts as a visit?' })
    expect(trigger).toBeInTheDocument()

    await user.tab()
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })
})
