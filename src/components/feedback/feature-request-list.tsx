import type { FeatureRequest } from '@/lib/services/feature-requests'

import { FeatureRequestEmptyState } from './feature-request-empty-state'
import { FeatureRequestRow } from './feature-request-row'

/**
 * One flat column, newest-and-most-wanted first. No sort control and no
 * pagination by design — the service caps the board at `MAX_BOARD_REQUESTS`.
 */
export function FeatureRequestList({
  requests,
}: {
  requests: FeatureRequest[]
}) {
  if (requests.length === 0) return <FeatureRequestEmptyState />

  return (
    <ul className="space-y-3">
      {requests.map((request) => (
        <li key={request.id}>
          <FeatureRequestRow request={request} />
        </li>
      ))}
    </ul>
  )
}
