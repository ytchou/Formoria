// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductTagField } from './product-tag-field'

function renderField(initialTags: string[] = [], suggestions: string[] = []) {
  return render(
    <ProductTagField
      initialTags={initialTags}
      inputLabel="Product tags"
      placeholder="Add product"
      removeLabel="Remove tag"
      maxLabel="Up to 5 tags"
      suggestions={suggestions}
    />
  )
}

describe('ProductTagField', () => {
  it('adds normalized tags and ignores case-insensitive duplicates', () => {
    const { container } = renderField(['Electric beds'])
    const input = screen.getByRole('combobox', { name: 'Product tags' })

    fireEvent.change(input, { target: { value: '  Wheelchair   lifts  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'electric BEDS' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Wheelchair lifts')).toBeInTheDocument()
    expect(container.querySelector<HTMLInputElement>('input[name="productTags"]')?.value)
      .toBe('Electric beds,Wheelchair lifts')
  })

  it('limits the editor to five tags and supports removal', () => {
    renderField(['One', 'Two', 'Three', 'Four', 'Five'])

    expect(screen.queryByRole('combobox', { name: 'Product tags' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag: Three' }))
    expect(screen.getByRole('combobox', { name: 'Product tags' })).toBeInTheDocument()
  })

  it('suggests existing tags while preserving free-form entry', () => {
    const { container } = renderField([], ['Ceramic mugs', 'Ceramic plates', 'Leather totes'])
    const input = screen.getByRole('combobox', { name: 'Product tags' })

    fireEvent.change(input, { target: { value: 'ceramic' } })
    expect(screen.getByRole('option', { name: 'Ceramic mugs' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ceramic plates' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Leather totes' })).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Ceramic mugs' }))
    fireEvent.click(screen.getByRole('option', { name: 'Ceramic mugs' }))
    fireEvent.change(input, { target: { value: 'Custom tea set' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(container.querySelector<HTMLInputElement>('input[name="productTags"]')?.value)
      .toBe('Ceramic mugs,Custom tea set')
  })

  it('does not suggest a tag that is already selected', () => {
    renderField(['Ceramic mugs'], ['Ceramic mugs', 'Ceramic plates'])
    const input = screen.getByRole('combobox', { name: 'Product tags' })

    fireEvent.change(input, { target: { value: 'ceramic' } })

    expect(screen.queryByRole('option', { name: 'Ceramic mugs' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ceramic plates' })).toBeInTheDocument()
  })
})
