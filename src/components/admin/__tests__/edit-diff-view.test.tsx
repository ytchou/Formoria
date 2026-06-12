// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditDiffView, computeDiffFields } from '../edit-diff-view'
import type { DiffField } from '../edit-diff-view'

const FIELDS: DiffField[] = [
  { field: '品牌描述', fieldKey: 'description', currentValue: 'Old desc', proposedValue: 'New desc', changed: true },
  { field: '品牌名稱', fieldKey: 'name', currentValue: 'Brand A', proposedValue: 'Brand A', changed: false },
]

it('renders changed fields with proposed value highlighted', () => {
  render(<EditDiffView fields={FIELDS} />)
  expect(screen.getByText('Old desc')).toBeInTheDocument()
  expect(screen.getByText('New desc')).toBeInTheDocument()
  expect(screen.getByText('目前版本')).toBeInTheDocument()
  expect(screen.getByText('提案修改')).toBeInTheDocument()
})

it('shows both unchanged and changed fields', () => {
  render(<EditDiffView fields={FIELDS} />)
  expect(screen.getAllByText('品牌描述').length).toBeGreaterThan(0)
  expect(screen.getAllByText('品牌名稱').length).toBeGreaterThan(0)
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
      { logoUrl: 'http://a.com/logo.png' },
      { logoUrl: 'http://b.com/logo.png' }
    )
    const logo = result.find((f: DiffField) => f.fieldKey === 'logoUrl')
    expect(logo?.isImage).toBe(true)
  })
})
