// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../../messages/en.json';
import { AccountMenu } from '../account-menu';

vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }));
vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }));

import { useUser } from '@/lib/auth/use-user';

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('AccountMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a Sign in link to /auth/sign-in when logged out', () => {
    (useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ user: null, loading: false });
    renderWithIntl(<AccountMenu />);
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/auth/sign-in');
  });

  it('shows an account trigger with the email initial when logged in', () => {
    (useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    });
    renderWithIntl(<AccountMenu />);
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('renders a non-interactive placeholder while loading', () => {
    (useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ user: null, loading: true });
    const { container } = renderWithIntl(<AccountMenu />);
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-account-menu-placeholder]')).toBeInTheDocument();
  });
});
