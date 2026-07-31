'use client'

import { RouteError } from '@/components/shared/route-error'

/**
 * No `descriptionKey` override: `errors.boundary` carries `brandDescription`
 * and `storyDescription` but no events-specific string, and inventing a message
 * key is outside this change. The generic `boundary.description` is accurate.
 */
export default function EventDetailError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} />
}
