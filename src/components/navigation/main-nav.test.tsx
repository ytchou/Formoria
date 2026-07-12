// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: React.ReactNode
    href: string
    className?: string
    onClick?: () => void
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'zh-TW',
  useTranslations:
    (namespace?: string) =>
    (key: string) => {
      const map: Record<string, Record<string, string>> = {
        nav: {
          brandDirectory: '品牌目錄',
          faq: '常見問題',
          support: '請我喝咖啡',
          mySubmissions: '我的提交',
          submitBrand: '提交品牌',
          languageLabel: '切換語言',
          languageTraditionalChinese: '繁體中文',
          languageEnglish: 'English',
        },
      }

      return namespace ? map[namespace]?.[key] ?? key : key
    },
}))

vi.mock('./nav-search-input', () => ({
  NavSearchInput: () => <div data-testid="nav-search-input" />,
}))

vi.mock('./nav-category-tabs', () => ({
  NavCategoryTabs: () => <div data-testid="nav-category-tabs" />,
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({ user: null, loading: false }),
}))

const mockCategories = [
  { slug: 'food', name: 'Food', nameZh: '食品' },
  { slug: 'fashion', name: 'Fashion', nameZh: '時尚' },
]

describe('MainNav brand', () => {
  it('renders the BrandMark svg and Formoria wordmark', async () => {
    const { MainNav } = await import('./main-nav')
    const { container } = render(<MainNav categories={mockCategories} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Formoria')).toBeInTheDocument()
  })
})

describe('MainNav', () => {
  it('renders Submit a Brand CTA link', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    const submitLinks = screen.getAllByRole('link', { name: '提交品牌' })
    expect(submitLinks[0]).toHaveAttribute('href', '/submit')
  })

  it('renders Submit a Brand CTA', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByRole('link', { name: '提交品牌' })).toHaveAttribute(
      'href',
      '/submit'
    )
  })

  it('does not render removed nav links (brandDirectory, mySubmissions)', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.queryByRole('link', { name: /品牌目錄/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /我的提交/ })).not.toBeInTheDocument()
  })

  it('renders mobile menu button on small screens', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument()
  })

  it('renders the language switcher trigger', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    // compact LocaleSwitcher shows the locale text as its accessible name
    expect(screen.getByRole('button', { name: '繁體中文' })).toBeInTheDocument()
  })
})
