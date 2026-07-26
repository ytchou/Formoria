// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, buttonVariants } from './button'

describe('Button', () => {


  it('supports the four product variants', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-primary')
    expect(buttonVariants({ variant: 'secondary' })).toContain('border-border')
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-muted')
    expect(buttonVariants({ variant: 'destructive' })).toContain('text-destructive')
  })

  it('supports overlay variant for translucent surfaces', () => {
    expect(buttonVariants({ variant: 'overlay' })).toContain('bg-accent/80')
    expect(buttonVariants({ variant: 'overlay' })).toContain('backdrop-blur-sm')
  })




})
