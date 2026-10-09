import { describe, expect, it } from 'vitest'

import {
  isDeploymentSkewError,
  serverActionResponseStatus,
} from './deployment-skew'

const UNEXPECTED = new Error('An unexpected response was received from the server.')

describe('isDeploymentSkewError', () => {
  it('matches the server-side unknown-action message', () => {
    expect(
      isDeploymentSkewError(new Error('Failed to find Server Action "abc123". This request might be from an older or newer deployment.')),
    ).toBe(true)
  })

  it("matches the client router's unrecognized-action error", () => {
    const error = new Error('Server Action "abc123" was not found on the server.')
    error.name = 'UnrecognizedActionError'
    expect(isDeploymentSkewError(error)).toBe(true)
  })

  it.each([404, 400])(
    'treats a non-RSC reply with status %i as skew',
    (status) => {
      expect(isDeploymentSkewError(UNEXPECTED, status)).toBe(true)
    },
  )

  it.each([403, 429, 500, 502])(
    'does not treat a non-RSC reply with status %i as skew',
    (status) => {
      expect(isDeploymentSkewError(UNEXPECTED, status)).toBe(false)
    },
  )

  it('does not treat a non-RSC reply with an unknown status as skew', () => {
    expect(isDeploymentSkewError(UNEXPECTED)).toBe(false)
  })

  it('does not match an unrelated error', () => {
    expect(isDeploymentSkewError(new Error('down'), 404)).toBe(false)
  })

  it('does not match non-Error values', () => {
    expect(isDeploymentSkewError('An unexpected response was received from the server.', 404)).toBe(false)
    expect(isDeploymentSkewError(undefined)).toBe(false)
  })
})

describe('serverActionResponseStatus', () => {
  const href = 'https://formoria.com/faq#top'

  function timeline(entries: Array<Partial<PerformanceResourceTiming>>) {
    const calls: string[] = []
    return {
      calls,
      perf: {
        getEntriesByName: (name: string) => {
          calls.push(name)
          return entries as PerformanceEntryList
        },
      },
    }
  }

  it('reads the status of the latest fetch to the page URL, without its hash', () => {
    const { calls, perf } = timeline([
      { initiatorType: 'fetch', responseStatus: 200 },
      { initiatorType: 'fetch', responseStatus: 403 },
    ])

    expect(serverActionResponseStatus(href, perf)).toBe(403)
    expect(calls).toEqual(['https://formoria.com/faq'])
  })

  it('ignores non-fetch entries and browsers that report no status', () => {
    const { perf } = timeline([
      { initiatorType: 'fetch', responseStatus: 429 },
      { initiatorType: 'fetch', responseStatus: 0 },
      { initiatorType: 'img', responseStatus: 404 },
    ])

    expect(serverActionResponseStatus(href, perf)).toBe(429)
  })

  it('is undefined when nothing was recorded or the API is missing', () => {
    expect(serverActionResponseStatus(href, timeline([]).perf)).toBeUndefined()
    expect(serverActionResponseStatus(href, {})).toBeUndefined()
    expect(serverActionResponseStatus(undefined, timeline([]).perf)).toBeUndefined()
  })
})
