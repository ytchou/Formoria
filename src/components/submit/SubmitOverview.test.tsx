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

  it('renders 登入並開始提交 CTA linking to sign-in with ?next=/submit/form', () => {
    renderWithZhTW(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /登入並開始提交/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/auth/sign-in?next=/submit/form');
  });

  it('includes a step count or time estimate', () => {
    renderWithZhTW(<SubmitOverview />);
    expect(
      screen.getByText(/步驟|分鐘|step/i)
    ).toBeInTheDocument();
  });
});
