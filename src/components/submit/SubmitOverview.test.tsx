// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SubmitOverview from './SubmitOverview';

describe('SubmitOverview', () => {
  it('renders a heading explaining Formoria', () => {
    render(<SubmitOverview />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders 登入並開始提交 CTA linking to sign-in with ?next=/submit', () => {
    render(<SubmitOverview />);
    const cta = screen.getByRole('link', { name: /登入並開始提交/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/auth/sign-in?next=/submit');
  });

  it('includes a step count or time estimate', () => {
    render(<SubmitOverview />);
    expect(
      screen.getByText(/步驟|分鐘|step/i)
    ).toBeInTheDocument();
  });
});
