// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import zhMessages from '../../../messages/zh-TW.json';
import SubmitOverview from './SubmitOverview';
import { trackSubmissionPathSelected } from '@/lib/analytics';

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
    renderWithZhTW(<SubmitOverview />);

    expect(
      screen.getByText(
        '推薦你喜歡的品牌，或以品牌主身分提交，之後認領並管理品牌頁面。',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '開始創建完整品牌資訊',
      }),
    ).toBeInTheDocument();
  });

  it('renders the Taiwanese brand inclusion criteria', () => {
    renderWithZhTW(<SubmitOverview />);

    expect(
      screen.getByText('我們收錄在台灣創立、設計或製造的品牌。'),
    ).toBeInTheDocument();
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

  it('directs an existing owner to the recommendation flow from a dialog', async () => {
    const user = userEvent.setup();
    renderWithZhTW(<SubmitOverview isLoggedIn hasOwnedBrand />);

    const trigger = screen.getByRole('button', { name: ownerCtaLoggedIn });
    await user.click(trigger);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('你已經擁有一個品牌');
    expect(dialog).toHaveTextContent(
      '每個帳號只能管理一個品牌，因此你無法再以品牌主身分提交其他品牌。若想分享其他品牌，請改用社群推薦流程。',
    );
    expect(dialog).toHaveClass('sm:!max-w-lg');
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '前往推薦品牌' }));

    expect(push).toHaveBeenCalledWith('/submit/recommend');
    expect(document.querySelector('a[href*="/submit/owner"]')).toBeNull();
  });

  it('closes without replacing the underlying submit overview and restores focus', async () => {
    const user = userEvent.setup();
    renderWithZhTW(<SubmitOverview isLoggedIn hasOwnedBrand />);
    const trigger = screen.getByRole('button', { name: ownerCtaLoggedIn });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes with Escape and restores focus to the owner action', async () => {
    const user = userEvent.setup();
    renderWithZhTW(<SubmitOverview isLoggedIn hasOwnedBrand />);
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
    renderWithZhTW(<SubmitOverview isLoggedIn hasOwnedBrand />);

    await user.click(screen.getByRole('button', { name: ownerCtaLoggedIn }));
    await user.click(screen.getByRole('button', { name: '前往推薦品牌' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(
      '目前無法前往推薦流程，請再試一次。',
    );
  });

  it('calls trackSubmissionPathSelected when recommendation CTA is clicked', async () => {
    const user = userEvent.setup();
    renderWithZhTW(<SubmitOverview isLoggedIn />);

    await user.click(screen.getByRole('link', { name: /推薦品牌/i }));

    expect(trackSubmissionPathSelected).toHaveBeenCalledWith('recommend', true);
  });

  it('calls trackSubmissionPathSelected when owner CTA is clicked', async () => {
    const user = userEvent.setup();
    renderWithZhTW(<SubmitOverview isLoggedIn />);

    await user.click(screen.getByRole('link', { name: zhMessages.submit.overview.ownerCtaLoggedIn }));

    expect(trackSubmissionPathSelected).toHaveBeenCalledWith('claim', true);
  });
});
