import { describe, expect, it } from 'vitest';

import { clientSentryOptions } from './instrumentation-client.options';

// `instrumentation-client.ts` passes this exact object to `Sentry.init`, so the
// options are the thing under test even though the init call is not.
describe('client Sentry options', () => {
  it('denies the GA collect hosts', () => {
    expect(clientSentryOptions.denyUrls).toContain('analytics.google.com');
    expect(clientSentryOptions.denyUrls).toContain('region1.analytics.google.com');
  });

  it('does not filter TypeError by bare message', () => {
    // `Load failed` and `Failed to fetch` are the generic browser wordings for
    // any blocked fetch. Matching either by message would silence real
    // same-origin failures site-wide, and a filter fails silently.
    const bareMessages = ['Load failed', 'Failed to fetch'];

    for (const entry of clientSentryOptions.ignoreErrors) {
      for (const bare of bareMessages) {
        expect(entry).not.toBe(bare);
        expect(bare).not.toMatch(new RegExp(`^${entry}$`));
      }
    }
  });

  it('preserves the existing iOS in-app browser filter', () => {
    expect(clientSentryOptions.ignoreErrors).toContain(
      "undefined is not an object (evaluating 'window.webkit.messageHandlers')"
    );
  });
});
