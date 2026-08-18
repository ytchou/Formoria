// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SubcategoryField } from './subcategory-field'

function renderField(
  initialSubcategories: string[] = [],
  suggestions: string[] = [],
) {
  return render(
    <SubcategoryField
      initialSubcategories={initialSubcategories}
      inputLabel="Product subcategories"
      placeholder="Add subcategory"
      removeLabel="Remove subcategory"
      maxLabel="Up to 5 subcategories"
      suggestions={suggestions}
    />
  )
}

describe('SubcategoryField', () => {
  it('adds normalized subcategories and ignores case-insensitive duplicates', () => {
    const { container } = renderField(['Electric beds'])
    const input = screen.getByRole('combobox', { name: 'Product subcategories' })

    fireEvent.change(input, { target: { value: '  Wheelchair   lifts  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'electric BEDS' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Wheelchair lifts')).toBeInTheDocument()
    expect(container.querySelector<HTMLInputElement>('input[name="subcategories"]')?.value)
      .toBe('Electric beds,Wheelchair lifts')
  })

  it('limits the editor to five subcategories and supports removal', () => {
    renderField(['One', 'Two', 'Three', 'Four', 'Five'])

    expect(screen.queryByRole('combobox', { name: 'Product subcategories' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove subcategory: Three' }))
    expect(screen.getByRole('combobox', { name: 'Product subcategories' })).toBeInTheDocument()
  })

  it('suggests existing subcategories while preserving free-form entry', () => {
    const { container } = renderField([], ['Ceramic mugs', 'Ceramic plates', 'Leather totes'])
    const input = screen.getByRole('combobox', { name: 'Product subcategories' })

    fireEvent.change(input, { target: { value: 'ceramic' } })
    expect(screen.getByRole('option', { name: 'Ceramic mugs' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ceramic plates' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Leather totes' })).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Ceramic mugs' }))
    fireEvent.click(screen.getByRole('option', { name: 'Ceramic mugs' }))
    fireEvent.change(input, { target: { value: 'Custom tea set' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(container.querySelector<HTMLInputElement>('input[name="subcategories"]')?.value)
      .toBe('Ceramic mugs,Custom tea set')
  })

  it('does not suggest a subcategory that is already selected', () => {
    renderField(['Ceramic mugs'], ['Ceramic mugs', 'Ceramic plates'])
    const input = screen.getByRole('combobox', { name: 'Product subcategories' })

    fireEvent.change(input, { target: { value: 'ceramic' } })

    expect(screen.queryByRole('option', { name: 'Ceramic mugs' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ceramic plates' })).toBeInTheDocument()
  })
})
