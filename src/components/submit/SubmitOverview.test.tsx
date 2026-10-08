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

const overview = zhMessages.submit.overview;

describe('SubmitOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a heading explaining Formoria', () => {
    renderWithZhTW(<SubmitOverview />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('describes the recommendation path in reader-facing terms', () => {
    renderWithZhTW(<SubmitOverview />);

    expect(screen.getByText(overview.description)).toBeInTheDocument();
    expect(screen.getByText('只要品牌名稱和網址就能送出')).toBeInTheDocument();
    // Taiwan usage (建立, not 創建) and no internal funnel jargon (SP-22).
    expect(document.body.textContent).not.toMatch(/創建|降低提交門檻/);
  });

  it('renders recommendation CTA without auth redirect', () => {
    renderWithZhTW(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /推薦品牌/i });
    expect(cta).toHaveAttribute('href', '/submit/recommend');
  });

  it('renders the selling points as a plain list, not boxed rows', () => {
    renderWithZhTW(<SubmitOverview />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.className).not.toMatch(/\bborder\b/);
    }
  });

  it('gives brand owners one plain line instead of a coming-soon card', () => {
    renderWithZhTW(<SubmitOverview />);

    // DEV-1956: the owner card said 即將推出 and had no way in, so a brand
    // owner arriving from /brands/join dead-ended. One line now points them
    // at the recommend form, and the owner fork (DEV-1570) stays unreachable.
    expect(screen.getByText(overview.ownerNote)).toBeInTheDocument();
    expect(screen.queryByText('即將推出')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
  });

  it('offers a signed-in visitor no owner action', () => {
    renderWithZhTW(<SubmitOverview isLoggedIn />);

    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
