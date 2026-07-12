// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FaqBlock } from '../faq-block'

describe('FaqBlock', () => {
  it('returns null when questions is null (crash case)', () => {
    const { container } = render(<FaqBlock questions={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when questions is undefined', () => {
    const { container } = render(<FaqBlock />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when questions is an empty array', () => {
    const { container } = render(<FaqBlock questions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders questions when a valid array is provided', () => {
    const questions = [
      { q: 'What is Formoria?', a: 'A Made in Taiwan brand directory.' },
      { q: 'How do I submit?', a: 'Use the submit form.' },
    ]
    render(<FaqBlock questions={questions} />)
    expect(screen.getByText('What is Formoria?')).toBeInTheDocument()
    expect(screen.getByText('A Made in Taiwan brand directory.')).toBeInTheDocument()
    expect(screen.getByText('How do I submit?')).toBeInTheDocument()
  })
})
