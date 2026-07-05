// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  trackListingSharedByOwner: vi.fn(),
}));

import { BadgeSection } from '@/components/dashboard/badge-section';
import { trackListingSharedByOwner } from '@/lib/analytics';

const props = {
  brandSlug: 'yu-cha-ye',
  brandUpdatedAt: '2026-07-01T00:00:00Z',
  siteUrl: 'https://formoria.com',
};

describe('Brand owner badge embed and share card actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies the embed snippet and fires badge_copied on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BadgeSection {...props} />);
    await userEvent.click(screen.getByTestId('badge-copy-button'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('utm_source=badge'));
      expect(trackListingSharedByOwner).toHaveBeenCalledWith('yu-cha-ye', 'badge_copied');
    });
  });

  it('does not fire analytics when clipboard write rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<BadgeSection {...props} />);
    await userEvent.click(screen.getByTestId('badge-copy-button'));
    await waitFor(() => {
      expect(trackListingSharedByOwner).not.toHaveBeenCalled();
    });
  });

  it('renders the card preview with a cache-busting version param and a download link', () => {
    render(<BadgeSection {...props} />);
    const preview = screen.getByTestId('share-card-preview');
    expect(preview).toHaveAttribute('src', expect.stringContaining('/api/share-card/yu-cha-ye?'));
    expect(screen.getByTestId('card-download-link')).toHaveAttribute(
      'href',
      expect.stringContaining('download=1'),
    );
  });

  it('clicking the download link fires card_downloaded analytics event', async () => {
    render(<BadgeSection {...props} />);
    await userEvent.click(screen.getByTestId('card-download-link'));
    expect(trackListingSharedByOwner).toHaveBeenCalledWith('yu-cha-ye', 'card_downloaded');
  });
});
