// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { BrandActions } from './brand-actions';
import zh from '../../../messages/zh-TW.json';

vi.mock('@/lib/analytics', () => ({
  trackExternalLinkClicked: vi.fn(),
  trackBrandPageShared: vi.fn(),
  trackDbClick: vi.fn(),
}));

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: null, loading: false })),
}));

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: vi.fn(() => ({ savedIds: new Set(), toggle: vi.fn(), loading: false })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}));

vi.mock('@/components/brands/report-dialog', () => ({
  ReportDialog: () => <button aria-label="檢舉">mock-report</button>,
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe('BrandActions', () => {
  it('renders 前往官網 link with bg-cta class when websiteUrl is provided', () => {
    renderWithIntl(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' brandName="測試品牌" />);
    const ctaLink = screen.getByRole('link', { name: /前往官網/i });
    expect(ctaLink).toBeInTheDocument();
    expect(ctaLink.className).toContain('bg-cta');
    expect(ctaLink.className).not.toContain('bg-terracotta');
  });
  it('does NOT render bookmark button', () => {
    renderWithIntl(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' brandName="測試品牌" />);
    expect(screen.queryByRole('button', { name: /收藏/i })).not.toBeInTheDocument();
  });
  it('renders report button when brandId is provided', () => {
    renderWithIntl(
      <BrandActions
        websiteUrl="https://example.com"
        brandSlug="test-brand"
        brandId="brand-uuid-123"
        brandName="測試品牌"
      />
    )
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })
  it('does not render report button when brandId is absent', () => {
    renderWithIntl(<BrandActions websiteUrl="https://example.com" brandSlug="test-brand" brandName="測試品牌" />)
    expect(screen.queryByRole('button', { name: /檢舉/i })).not.toBeInTheDocument()
  })
  it('renders share button', () => {
    renderWithIntl(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' brandName="測試品牌" />);
    expect(screen.getByRole('button', { name: /分享/i })).toBeInTheDocument();
  });
  it('renders mobile sticky bar with 前往官網 when websiteUrl is provided', () => {
    renderWithIntl(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' brandName="測試品牌" />);
    expect(screen.getByTestId('mobile-cta-bar')).toBeInTheDocument();
    const stickyLink = screen.getByTestId('mobile-cta-bar').querySelector('a');
    expect(stickyLink).toHaveAttribute('href', 'https://example.com');
  });
  it('does NOT render 前往官網 link when websiteUrl is null', () => {
    renderWithIntl(<BrandActions websiteUrl={null} brandSlug='test-brand' brandName="測試品牌" />);
    expect(screen.queryByRole('link', { name: /前往官網/i })).not.toBeInTheDocument();
  });
});
