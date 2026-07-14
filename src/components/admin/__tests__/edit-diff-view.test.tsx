// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditDiffView, computeDiffFields } from '../edit-diff-view'
import type { DiffField } from '../edit-diff-view'

const FIELDS: DiffField[] = [
  { field: 'Brand description', fieldKey: 'description', currentValue: 'Old desc', proposedValue: 'New desc', changed: true },
  { field: 'Brand name', fieldKey: 'name', currentValue: 'Brand A', proposedValue: 'Brand A', changed: false },
]

it('renders changed fields with proposed value highlighted', () => {
  render(<EditDiffView fields={FIELDS} />)
  expect(screen.getByText('Old desc')).toBeInTheDocument()
  expect(screen.getByText('New desc')).toBeInTheDocument()
  expect(screen.getByText('Current version')).toBeInTheDocument()
  expect(screen.getByText('Proposed change')).toBeInTheDocument()
})

it('shows both unchanged and changed fields', () => {
  render(<EditDiffView fields={FIELDS} />)
  expect(screen.getAllByText('Brand description').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Brand name').length).toBeGreaterThan(0)
})

it('labels mitStory as "MIT story" in the diff view', () => {
  const proposed = { mitStory: 'Our story.' }
  const current = { mitStory: null }
  const fields = computeDiffFields(
    current as Record<string, unknown>,
    proposed as Record<string, unknown>
  )

  render(<EditDiffView fields={fields} />)

  expect(screen.getByText('MIT story')).toBeInTheDocument()
})

describe('computeDiffFields', () => {
  it('flags changed fields correctly', () => {
    const result = computeDiffFields(
      { name: 'Old Name', description: 'Same' },
      { name: 'New Name', description: 'Same' }
    )
    const name = result.find((f: DiffField) => f.fieldKey === 'name')
    const desc = result.find((f: DiffField) => f.fieldKey === 'description')
    expect(name?.changed).toBe(true)
    expect(desc?.changed).toBe(false)
  })

  it('marks image fields', () => {
    const result = computeDiffFields(
      { heroImageUrl: 'http://a.com/hero.png' },
      { heroImageUrl: 'http://b.com/hero.png' }
    )
    const hero = result.find((f: DiffField) => f.fieldKey === 'heroImageUrl')
    expect(hero?.isImage).toBe(true)
  })
})
