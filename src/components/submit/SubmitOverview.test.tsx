// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import zhMessages from '../../../messages/zh-TW.json';
import SubmitOverview from './SubmitOverview';

vi.mock('@/lib/analytics', () => ({
  trackSubmissionPathSelected: vi.fn(),
}))

const { push, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError },
}));

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
  useRouter: () => ({ push }),
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
    renderWithZhTW(<SubmitOverview ownerFeaturesEnabled />);

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

  it('renders owner CTA behind sign-in when logged out', () => {
    renderWithZhTW(<SubmitOverview ownerFeaturesEnabled />);
    const cta = screen.getByRole('link', { name: /登入後開始/i });
    expect(cta).toHaveAttribute('href', '/auth/sign-in?next=%2Fsubmit%2Fowner');
  });

  it('shows the owner fork as coming soon, with no way in, when owner features are disabled', () => {
    renderWithZhTW(<SubmitOverview ownerFeaturesEnabled={false} />);

    // The card keeps its slot so enabling the flag never re-lays out the page,
    // but it must offer no route into a fork that 404s.
    expect(
      screen.getByRole('heading', { level: 2, name: '開始創建完整品牌資訊' }),
    ).toBeInTheDocument();
    expect(screen.getByText('即將推出')).toBeInTheDocument();
    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
    expect(
      screen.getByRole('link', { name: /推薦品牌/i }),
    ).toHaveAttribute('href', '/submit/recommend');
  });

  it('offers a signed-in visitor no owner action when owner features are disabled', () => {
    renderWithZhTW(<SubmitOverview isLoggedIn ownerFeaturesEnabled={false} />);

    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: ownerCtaLoggedIn }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('即將推出')).toBeInTheDocument();
  });

  it('directs an existing owner to the recommendation flow from a dialog', async () => {
    const user = userEvent.setup();
    renderWithZhTW(
      <SubmitOverview isLoggedIn hasOwnedBrand ownerFeaturesEnabled />,
    );

    const trigger = screen.getByRole('button', { name: ownerCtaLoggedIn });
    await user.click(trigger);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('你已經擁有一個品牌');
    expect(dialog).toHaveTextContent(
      '每個帳號只能管理一個品牌，因此你無法再透過品牌主流程建立另一個品牌頁。若想分享其他品牌，請改用社群推薦流程。',
    );
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '前往推薦品牌' }));

    expect(push).toHaveBeenCalledWith('/submit/recommend');
    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
  });

  it('closes without replacing the underlying submit overview and restores focus', async () => {
    const user = userEvent.setup();
    renderWithZhTW(
      <SubmitOverview isLoggedIn hasOwnedBrand ownerFeaturesEnabled />,
    );
    const trigger = screen.getByRole('button', { name: ownerCtaLoggedIn });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes with Escape and restores focus to the owner action', async () => {
    const user = userEvent.setup();
    renderWithZhTW(
      <SubmitOverview isLoggedIn hasOwnedBrand ownerFeaturesEnabled />,
    );
    const trigger = screen.getByRole('button', { name: ownerCtaLoggedIn });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps the restriction dialog open when recommendation navigation fails', async () => {
    const user = userEvent.setup();
    push.mockImplementationOnce(() => {
      throw new Error('navigation failed');
    });
    renderWithZhTW(
      <SubmitOverview isLoggedIn hasOwnedBrand ownerFeaturesEnabled />,
    );

    await user.click(screen.getByRole('button', { name: ownerCtaLoggedIn }));
    await user.click(screen.getByRole('button', { name: '前往推薦品牌' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(
      '目前無法前往推薦流程，請再試一次。',
    );
  });


});
