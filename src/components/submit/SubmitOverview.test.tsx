// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import zhMessages from '../../../messages/zh-TW.json';
import SubmitOverview from './SubmitOverview';

vi.mock('@/lib/analytics', () => ({
  trackSubmissionPathSelected: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ownerCtaLoggedIn = zhMessages.submit.overview.ownerCtaLoggedIn;

describe('SubmitOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a heading explaining Formoria', () => {
    renderWithZhTW(<SubmitOverview />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('explains the owner submission path with concise copy', () => {
    renderWithZhTW(<SubmitOverview />);

    expect(
      screen.getByText('與社群分享你喜歡的台灣品牌，我們會審核後收錄進品牌目錄。'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '開始創建完整品牌資訊',
      }),
    ).toBeInTheDocument();
  });

  it('renders recommendation CTA without auth redirect', () => {
    renderWithZhTW(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /推薦品牌/i });
    expect(cta).toHaveAttribute('href', '/submit/recommend');
  });

  it('shows the owner fork as coming soon, with no way in', () => {
    renderWithZhTW(<SubmitOverview />);

    // The card keeps its slot so the page keeps its two-column layout, but the
    // owner fork was removed (DEV-1570) and must offer no route into it.
    expect(
      screen.getByRole('heading', { level: 2, name: '開始創建完整品牌資訊' }),
    ).toBeInTheDocument();
    expect(screen.getByText('即將推出')).toBeInTheDocument();
    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
    expect(
      screen.getByRole('link', { name: /推薦品牌/i }),
    ).toHaveAttribute('href', '/submit/recommend');
  });

  it('offers a signed-in visitor no owner action', () => {
    renderWithZhTW(<SubmitOverview isLoggedIn />);

    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: ownerCtaLoggedIn }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('即將推出')).toBeInTheDocument();
  });
});
