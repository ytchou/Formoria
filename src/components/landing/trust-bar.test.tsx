// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TrustBar from './trust-bar'

describe('TrustBar', () => {
  it('renders brand count and category count', () => {
    render(<TrustBar brandCount={42} categoryCount={8} />)

    expect(screen.getByText(/42/)).toBeInTheDocument()
    expect(screen.getByText(/8/)).toBeInTheDocument()
  })

  it('renders community curation label', () => {
    render(<TrustBar brandCount={10} categoryCount={3} />)

    expect(screen.getByText(/社群共建/)).toBeInTheDocument()
  })

  it('renders zero counts without crashing', () => {
    render(<TrustBar brandCount={0} categoryCount={0} />)

    expect(screen.getAllByText(/0/).length).toBeGreaterThanOrEqual(2)
  })
})
