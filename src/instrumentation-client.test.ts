import { describe, expect, it } from 'vitest';

import { clientSentryOptions } from './instrumentation-client.options';

// `instrumentation-client.ts` passes this exact object to `Sentry.init`, so the
// options are the thing under test even though the init call is not.
//
// The assertions run BEHAVIOR, not array membership: the previous `denyUrls`
// entries were members of an array that Sentry never matched against an error
// value, and a membership test stayed green the whole time.

// Mirrors `isMatchingPattern` in @sentry/core `utils/string.js`: a RegExp entry
// is a `.test()`, a string entry a substring check. Re-deriving a regex from a
// string entry would be both wrong and fragile -- the iOS entry carries regex
// metacharacters and compiles only by luck of balanced parens.
const matches = (pattern: string | RegExp, value: string): boolean =>
  pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern);

// What Sentry feeds to `ignoreErrors`: `getPossibleEventMessages` pushes the
// last exception's `value` and `${type}: ${value}`.
const isFiltered = (value: string): boolean =>
  [value, `TypeError: ${value}`].some((message) =>
    clientSentryOptions.ignoreErrors.some((entry) => matches(entry, message))
  );

describe('client Sentry options', () => {
  it('filters the GA collect failure on the Chrome wording with the host', () => {
    expect(isFiltered('Failed to fetch (analytics.google.com)')).toBe(true);
  });

  it('filters the regional GA collect host', () => {
    expect(isFiltered('Failed to fetch (region1.analytics.google.com)')).toBe(true);
  });

  it('filters the Safari wording when it carries the GA host', () => {
    expect(isFiltered('Load failed (analytics.google.com)')).toBe(true);
  });

  it('does not filter a bare Failed to fetch', () => {
    expect(isFiltered('Failed to fetch')).toBe(false);
  });

  it('does not filter a bare Load failed', () => {
    // `Load failed` is Safari's generic wording for ANY failed fetch, and a
    // real unrelated production issue (FORMORIA-6T) is exactly this message.
    expect(isFiltered('Load failed')).toBe(false);
  });

  it('does not filter a same-origin fetch failure to another host', () => {
    expect(isFiltered('Failed to fetch (formoria.com)')).toBe(false);
  });

  it('preserves the existing iOS in-app browser filter', () => {
    expect(
      isFiltered("undefined is not an object (evaluating 'window.webkit.messageHandlers')")
    ).toBe(true);
  });

  it('does not carry a denyUrls entry, which matches stack frames not hosts', () => {
    expect('denyUrls' in clientSentryOptions).toBe(false);
  });
});
