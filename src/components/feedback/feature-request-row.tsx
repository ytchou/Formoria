import type { ComponentProps } from 'react'
import { useTranslations } from 'next-intl'

import { SurfaceCard } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Typography } from '@/components/ui/typography'
import type {
  FeatureRequest,
  FeatureRequestStatus,
} from '@/lib/services/feature-requests'

import { UpvoteButton } from './upvote-button'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

/**
 * Status -> badge treatment. Only `open` through `declined` can reach the
 * public board: `duplicate` rows carry a `merged_into_id`, and the board query
 * filters those out. The key is here only because the map is exhaustive over
 * the status union, and the row skips the badge for it.
 */
const STATUS_BADGE: Record<FeatureRequestStatus, BadgeVariant> = {
  open: 'secondary',
  planned: 'outline',
  in_progress: 'warning',
  shipped: 'success',
  // `declared`, not `ghost`: the ghost variant carries hover rules only, so it
  // renders as plain text on a badge base that is otherwise transparent.
  declined: 'declared',
  duplicate: 'declared',
}

export function FeatureRequestRow({ request }: { request: FeatureRequest }) {
  const t = useTranslations('feedback')
  const title = request.i18nKey
    ? t(`requests.${request.i18nKey}.title`)
    : request.title
  const body = request.i18nKey
    ? t(`requests.${request.i18nKey}.body`)
    : request.body

  return (
    <SurfaceCard tone="card" padding="md" className="flex items-start gap-4">
      <UpvoteButton
        requestId={request.id}
        title={title}
        count={request.voteCount}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Typography as="h2" variant="cardTitle" className="min-w-0">
            {title}
          </Typography>
          {request.status !== 'duplicate' && (
            <Badge variant={STATUS_BADGE[request.status]}>
              {t(`status.${request.status}`)}
            </Badge>
          )}
        </div>
        {body ? (
          <Typography variant="cardDescription" className="line-clamp-2">
            {body}
          </Typography>
        ) : null}
      </div>
    </SurfaceCard>
  )
}
