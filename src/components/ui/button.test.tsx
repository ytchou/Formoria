// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, buttonVariants } from './button'

describe('Button', () => {
  it('uses the slimmer green primary action by default', () => {
    render(<Button>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'h-10',
      'rounded-lg',
      'bg-primary',
    )
  })

  it('provides the terracotta CTA tone at the same size', () => {
    render(<Button variant="primary" tone="cta">Publish</Button>)

    expect(screen.getByRole('button', { name: 'Publish' })).toHaveClass(
      'h-10',
      'rounded-lg',
      'bg-cta',
    )
  })

  it('supports the four product variants', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-primary')
    expect(buttonVariants({ variant: 'secondary' })).toContain('border-border')
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-muted')
    expect(buttonVariants({ variant: 'destructive' })).toContain('text-destructive')
  })

  it('keeps shape separate from variant', () => {
    render(<Button shape="pill">Open</Button>)

    expect(screen.getByRole('button', { name: 'Open' })).toHaveClass(
      'rounded-full',
    )
  })

  it('supports square icon buttons', () => {
    render(
      <Button size="icon" shape="square" aria-label="Close">
        <span aria-hidden="true">x</span>
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'size-10',
      'rounded-md',
    )
  })

  it('keeps compact slim and large slightly taller', () => {
    render(
      <>
        <Button size="compact">Compact</Button>
        <Button size="large">Large</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Compact' })).toHaveClass(
      'h-10',
      'px-3',
    )
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass(
      'h-11',
      'px-5',
    )
  })
})
