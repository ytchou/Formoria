import { useTranslations } from 'next-intl'

import { SurfaceCard } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import type {
  FeatureRequest,
  FeatureRequestStatus,
} from '@/lib/services/feature-requests'

import { FeatureRequestRow } from './feature-request-row'

/**
 * Section order, and the statuses each section absorbs. `declined`,
 * `duplicate`, and `shipped` are deliberately unlisted rather than given a
 * section of their own:
 * `buildFeatureRequestBoard` already drops all three before they reach here,
 * and leaving them unmatched means the partition fails closed — a status added
 * to the union later renders nowhere instead of silently landing in a section
 * that was never designed to explain it.
 */
const SECTIONS: readonly {
  key: string
  statuses: readonly FeatureRequestStatus[]
}[] = [
  { key: 'inProgress', statuses: ['in_progress'] },
  // `planned` gets its own section rather than sharing the in-progress one:
  // that section's description is the literal claim "these are being built
  // right now", and a committed-but-not-started row rendered under it is a
  // promise the roadmap cannot keep. Both still sit above `open`, which is the
  // point — momentum first.
  { key: 'planned', statuses: ['planned'] },
  { key: 'open', statuses: ['open'] },
]

/**
 * Three status sections — in progress, planned, open — each a column of rows.
 * Grouping exists because status is what signals momentum, and the service
 * sorts the board by vote count first: on one flat list a 0-vote `in_progress`
 * request sinks below every popular `open` one, so the thing actually being
 * built ends up the least visible row on the page. Ordering stays the service's
 * job — the incoming order is preserved inside each section, where
 * most-wanted-first still means something. No sort control and no pagination by
 * design: the service caps the board at `MAX_BOARD_REQUESTS`.
 *
 * Every section renders whether or not it has rows. The board doubles as a
 * public roadmap, and a section that disappears when empty makes the roadmap's
 * shape depend on its contents — a visitor cannot tell "nothing is queued up"
 * apart from "there is no queue". An empty section carries its own copy rather
 * than a bare heading, so it reads as "nothing here yet" instead of a broken
 * page. This is also why there is no whole-board empty state: three empty
 * sections say more than one card that hides the shape entirely.
 */
export function FeatureRequestList({
  requests,
}: {
  requests: FeatureRequest[]
}) {
  const t = useTranslations('feedback.sections')

  return (
    <div className="space-y-8">
      {SECTIONS.map(({ key, statuses }) => {
        const sectionRequests = requests.filter((request) =>
          statuses.includes(request.status),
        )
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
            {sectionRequests.length === 0 ? (
              // `background`, not the rows' `card` tone: an empty section must
              // read as a placeholder the eye can skip, not as a row with no
              // content in it.
              <SurfaceCard tone="background" padding="md">
                <Typography variant="emptyBody">{t(`${key}.empty`)}</Typography>
              </SurfaceCard>
            ) : (
              <ul className="space-y-3">
                {sectionRequests.map((request) => (
                  <li key={request.id}>
                    <FeatureRequestRow request={request} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
