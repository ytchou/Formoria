// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('uses the 36px green standard action by default', () => {
    render(<Button>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'h-9',
      'rounded-lg',
      'bg-primary',
    )
  })

  it('provides the terracotta CTA variant at the same size', () => {
    render(<Button variant="cta">Publish</Button>)

    expect(screen.getByRole('button', { name: 'Publish' })).toHaveClass(
      'h-9',
      'rounded-lg',
      'bg-cta',
    )
  })
})
