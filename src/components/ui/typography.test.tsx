// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Typography } from './typography'

describe('Typography', () => {
  it('applies the semantic type utility for a variant', () => {
    render(<Typography variant="sectionTitle">基本資料</Typography>)

    expect(screen.getByText('基本資料')).toHaveClass('type-section-title')
  })

  it('renders the requested semantic element', () => {
    render(
      <Typography as="h1" variant="pageTitle">
        品牌後台導覽
      </Typography>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: '品牌後台導覽' }),
    ).toHaveClass('type-page-title')
  })
})
