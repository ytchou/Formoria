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
})
