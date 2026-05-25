// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DynamicArrayField } from '../dynamic-array-field'

type Link = { platform: string; url: string }

const renderLink = (item: Link, index: number, onRemove: () => void) => (
  <div key={index}>
    <span>{item.platform}</span>
    <button type="button" onClick={onRemove}>Remove</button>
  </div>
)

const emptyLink = (): Link => ({ platform: '', url: '' })

describe('DynamicArrayField', () => {
  it('renders with initial items', () => {
    render(
      <DynamicArrayField
        initialItems={[{ platform: 'shopee', url: 'https://shopee.tw' }]}
        renderItem={renderLink}
        createItem={emptyLink}
        addLabel="Add link"
      />
    )
    expect(screen.getByText('shopee')).toBeInTheDocument()
  })

  it('adds a row when the Add button is clicked', async () => {
    render(
      <DynamicArrayField
        initialItems={[]}
        renderItem={renderLink}
        createItem={emptyLink}
        addLabel="Add link"
      />
    )
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('removes a row when Remove is clicked', async () => {
    render(
      <DynamicArrayField
        initialItems={[{ platform: 'shopee', url: '' }]}
        renderItem={renderLink}
        createItem={emptyLink}
        addLabel="Add link"
      />
    )
    expect(screen.getByText('shopee')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('shopee')).not.toBeInTheDocument()
  })

  it('renders hidden inputs for form submission with array notation', () => {
    const { container } = render(
      <DynamicArrayField
        name="links"
        initialItems={[{ platform: 'shopee', url: 'https://shopee.tw' }]}
        renderItem={renderLink}
        createItem={emptyLink}
        addLabel="Add link"
      />
    )
    expect(container.querySelector('input[name="links[0].platform"]')).toBeTruthy()
  })
})
