import { useTranslations } from 'next-intl'

import { Typography } from '@/components/ui/typography'
import type {
  FeatureRequest,
  FeatureRequestStatus,
} from '@/lib/services/feature-requests'

import { FeatureRequestEmptyState } from './feature-request-empty-state'
import { FeatureRequestRow } from './feature-request-row'

/**
 * Section order, and the statuses each section absorbs. `declined` and
 * `duplicate` are deliberately unlisted rather than given a fourth section:
 * `buildFeatureRequestBoard` already drops both before they reach here, and
 * leaving them unmatched means the partition fails closed — a status added to
 * the union later renders nowhere instead of silently landing in a section that
 * was never designed to explain it.
 */
const SECTIONS: readonly {
  key: string
  statuses: readonly FeatureRequestStatus[]
}[] = [
  { key: 'inProgress', statuses: ['in_progress', 'planned'] },
  { key: 'open', statuses: ['open'] },
  { key: 'shipped', statuses: ['shipped'] },
]

/**
 * Three status sections — in progress, open, shipped — each a column of rows.
 * Grouping exists because status is what signals momentum, and the service
 * sorts the board by vote count first: on one flat list a 0-vote `in_progress`
 * request sinks below every popular `open` one, so the thing actually being
 * built ends up the least visible row on the page. Ordering stays the service's
 * job — the incoming order is preserved inside each section, where
 * most-wanted-first still means something. No sort control and no pagination by
 * design: the service caps the board at `MAX_BOARD_REQUESTS`.
 */
export function FeatureRequestList({
  requests,
}: {
  requests: FeatureRequest[]
}) {
  const t = useTranslations('feedback.sections')

  if (requests.length === 0) return <FeatureRequestEmptyState />

  return (
    <div className="space-y-8">
      {SECTIONS.map(({ key, statuses }) => {
        const sectionRequests = requests.filter((request) =>
          statuses.includes(request.status),
        )
        // An empty section renders nothing at all: a heading over no rows reads
        // as a broken page, not as "nothing here yet".
        if (sectionRequests.length === 0) return null

        return (
          <section key={key} className="space-y-3">
            <div className="space-y-1">
              <Typography as="h2" variant="sectionTitle">
                {t(`${key}.title`)}
              </Typography>
              <Typography variant="sectionDescription">
                {t(`${key}.description`)}
              </Typography>
            </div>
            <ul className="space-y-3">
              {sectionRequests.map((request) => (
                <li key={request.id}>
                  <FeatureRequestRow request={request} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
