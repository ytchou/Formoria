import { describe, expect, it } from 'vitest'

import { isDeploymentSkewError } from './deployment-skew'

describe('isDeploymentSkewError', () => {
  it('matches the server-side unknown-action message', () => {
    expect(
      isDeploymentSkewError(new Error('Failed to find Server Action "abc123". This request might be from an older or newer deployment.')),
    ).toBe(true)
  })

  it("matches the client router's non-RSC response message", () => {
    expect(
      isDeploymentSkewError(new Error('An unexpected response was received from the server.')),
    ).toBe(true)
  })

  it('does not match an unrelated error', () => {
    expect(isDeploymentSkewError(new Error('down'))).toBe(false)
  })

  it('does not match non-Error values', () => {
    expect(isDeploymentSkewError('An unexpected response was received from the server.')).toBe(false)
    expect(isDeploymentSkewError(undefined)).toBe(false)
  })
})
