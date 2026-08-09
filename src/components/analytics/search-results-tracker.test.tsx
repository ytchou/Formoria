/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'

const trackSearchExecuted = vi.fn()
const trackSearchNoResults = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackSearchExecuted: (...args: unknown[]) => trackSearchExecuted(...args),
  trackSearchNoResults: (...args: unknown[]) => trackSearchNoResults(...args),
}))

import {
  SearchResultsTracker,
  SEARCH_SETTLE_MS,
  __resetSearchTrackerForTests,
} from './search-results-tracker'

function settle(ms = SEARCH_SETTLE_MS) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('SearchResultsTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    trackSearchExecuted.mockClear()
    trackSearchNoResults.mockClear()
    __resetSearchTrackerForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the server result count, not a capped suggestion count', () => {
    render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledExactlyOnceWith('陶瓷', 41)
    expect(trackSearchNoResults).not.toHaveBeenCalled()
  })

  it('reports an empty search only when the results page really found nothing', () => {
    render(<SearchResultsTracker query="小提琴" resultCount={0} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledExactlyOnceWith('小提琴', 0)
    expect(trackSearchNoResults).toHaveBeenCalledExactlyOnceWith('小提琴')
  })

  it('emits nothing when there is no search', () => {
    render(<SearchResultsTracker query="" resultCount={718} />)
    settle()

    expect(trackSearchExecuted).not.toHaveBeenCalled()
    expect(trackSearchNoResults).not.toHaveBeenCalled()
  })

  // Typing into the directory search box rewrites the URL per keystroke, so the
  // server re-renders this tracker with each prefix. Only the query the visitor
  // stopped on is a search they actually made.
  it('does not emit a prefix the visitor typed through', () => {
    const { rerender } = render(<SearchResultsTracker query="香" resultCount={3} />)
    act(() => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS - 50)
    })
    rerender(<SearchResultsTracker query="香氛" resultCount={1} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledExactlyOnceWith('香氛', 1)
  })

  // Pagination and back-navigation re-render the same search. One search, one event.
  it('emits once per query across re-renders', () => {
    const { rerender } = render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()
    rerender(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledOnce()
  })

  it('emits again for a query the visitor returns to after searching something else', () => {
    const { rerender } = render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()
    rerender(<SearchResultsTracker query="香氛" resultCount={1} />)
    settle()
    rerender(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledTimes(3)
  })

  // `normalizePublicSearchQuery` rejects anything shorter than two characters and
  // returns zero results without calling the RPC — so a single ideograph, the first
  // keystroke of every Chinese search, is not a search that happened.
  it('emits nothing for a query the service would reject as too short', () => {
    render(<SearchResultsTracker query="茶" resultCount={0} />)
    settle()

    expect(trackSearchExecuted).not.toHaveBeenCalled()
    expect(trackSearchNoResults).not.toHaveBeenCalled()
  })

  // A filter ticked on keeps `search=` in the URL but changes what it matched. The
  // zero-result version is the catalog-gap signal, so it must not be deduped away.
  it('emits again when the same query is narrowed to a different result count', () => {
    const { rerender } = render(<SearchResultsTracker query="保養" resultCount={24} />)
    settle()
    rerender(<SearchResultsTracker query="保養" resultCount={0} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenNthCalledWith(1, '保養', 24)
    expect(trackSearchExecuted).toHaveBeenNthCalledWith(2, '保養', 0)
    expect(trackSearchNoResults).toHaveBeenCalledExactlyOnceWith('保養')
  })

  // Clicking a brand card unmounts DirectoryView mid-settle. That is the highest-intent
  // search there is; dropping the pending timer would silently lose it.
  it('flushes a pending search when the visitor navigates away mid-settle', () => {
    const { unmount } = render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    act(() => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS - 400)
    })
    unmount()

    expect(trackSearchExecuted).toHaveBeenCalledExactlyOnceWith('陶瓷', 41)
  })

  it('does not double-emit on unmount after the settle timer already fired', () => {
    const { unmount } = render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()
    unmount()

    expect(trackSearchExecuted).toHaveBeenCalledOnce()
  })

  // The guard must outlive the component instance: a client-side navigation between
  // directory URLs remounts the tracker, and a remount is not a new search. A plain
  // `useRef` would pass every rerender-only test above and still double-emit here.
  it('emits once for the same search across a remount', () => {
    const first = render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()
    first.unmount()

    render(<SearchResultsTracker query="陶瓷" resultCount={41} />)
    settle()

    expect(trackSearchExecuted).toHaveBeenCalledOnce()
  })
})
