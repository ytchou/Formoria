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
})
