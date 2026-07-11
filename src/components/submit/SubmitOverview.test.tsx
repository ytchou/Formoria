// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import zhMessages from '../../../messages/zh-TW.json';
import SubmitOverview from './SubmitOverview';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SubmitOverview', () => {
  it('renders a heading explaining Formoria', () => {
    renderWithZhTW(<SubmitOverview />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders recommendation CTA without auth redirect', () => {
    renderWithZhTW(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /推薦品牌/i });
    expect(cta).toHaveAttribute('href', '/submit/recommend');
  });

  it('renders owner CTA behind sign-in when logged out', () => {
    renderWithZhTW(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /登入後開始/i });
    expect(cta).toHaveAttribute('href', '/auth/sign-in?next=%2Fsubmit%2Fowner');
  });
});
