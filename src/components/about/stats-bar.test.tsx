// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatsBar from './stats-bar'

describe('StatsBar', () => {
  it('renders brand count and category count in large format', () => {
    render(<StatsBar brandCount={42} categoryCount={8} brandUnit="個品牌" categoryUnit="個分類" />)

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('renders descriptive labels', () => {
    render(<StatsBar brandCount={10} categoryCount={3} brandUnit="個品牌" categoryUnit="個分類" />)

    expect(screen.getByText(/品牌/)).toBeInTheDocument()
    expect(screen.getByText(/分類/)).toBeInTheDocument()
  })

  it('renders zero counts without crashing', () => {
    render(<StatsBar brandCount={0} categoryCount={0} brandUnit="個品牌" categoryUnit="個分類" />)

    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })
})
