// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BrandActions } from './brand-actions';

vi.mock('@/lib/analytics', () => ({
  trackExternalLinkClicked: vi.fn(),
  trackBrandPageShared: vi.fn(),
}));

vi.mock('@/components/brands/report-dialog', () => ({
  ReportDialog: (_props: { brandId: string; brandSlug: string }) => (
    <button aria-label="檢舉">mock-report</button>
  ),
}));

describe('BrandActions', () => {
  it('renders 前往官網 link with bg-cta class when websiteUrl is provided', () => {
    render(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' />);
    const ctaLink = screen.getByRole('link', { name: /前往官網/i });
    expect(ctaLink).toBeInTheDocument();
    expect(ctaLink.className).toContain('bg-cta');
    expect(ctaLink.className).not.toContain('bg-terracotta');
  });
  it('does NOT render bookmark button', () => {
    render(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' />);
    expect(screen.queryByRole('button', { name: /收藏/i })).not.toBeInTheDocument();
  });
  it('renders report button when brandId is provided', () => {
    render(
      <BrandActions
        websiteUrl="https://example.com"
        brandSlug="test-brand"
        brandId="brand-uuid-123"
      />
    )
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })
  it('does not render report button when brandId is absent', () => {
    render(<BrandActions websiteUrl="https://example.com" brandSlug="test-brand" />)
    expect(screen.queryByRole('button', { name: /檢舉/i })).not.toBeInTheDocument()
  })
  it('renders share button', () => {
    render(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' />);
    expect(screen.getByRole('button', { name: /分享/i })).toBeInTheDocument();
  });
  it('renders mobile sticky bar with 前往官網 when websiteUrl is provided', () => {
    render(<BrandActions websiteUrl='https://example.com' brandSlug='test-brand' />);
    expect(screen.getByTestId('mobile-cta-bar')).toBeInTheDocument();
    const stickyLink = screen.getByTestId('mobile-cta-bar').querySelector('a');
    expect(stickyLink).toHaveAttribute('href', 'https://example.com');
  });
  it('does NOT render 前往官網 link when websiteUrl is null', () => {
    render(<BrandActions websiteUrl={null} brandSlug='test-brand' />);
    expect(screen.queryByRole('link', { name: /前往官網/i })).not.toBeInTheDocument();
  });
});
