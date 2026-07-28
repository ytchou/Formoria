import { Inbox } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SurfaceCard } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

/**
 * Local composition, deliberately not extracted into `components/ui/`: the
 * board is the only surface that needs it, and one caller does not earn a
 * primitive.
 */
export function FeatureRequestEmptyState() {
  const t = useTranslations('feedback.empty')

  return (
    <SurfaceCard
      tone="card"
      padding="lg"
      data-empty
      className="flex flex-col items-center gap-2 text-center"
    >
      <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
      <Typography as="h2" variant="emptyTitle">
        {t('title')}
      </Typography>
      <Typography variant="emptyBody" className="max-w-prose">
        {t('description')}
      </Typography>
    </SurfaceCard>
  )
}
