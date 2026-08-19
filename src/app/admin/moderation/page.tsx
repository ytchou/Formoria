import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { reviewModerationFlagAction } from '@/app/admin/actions'
import { ModerationQueue } from '@/components/admin/moderation-queue'
import { requireAdminPage } from '@/lib/auth/require-admin'
import { getFlaggedContent } from '@/lib/services/moderation'
import { routes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.moderation')

  return {
    title: t('dashboard'),
  }
}

export default async function ReviewQueueModerationPage() {
  await requireAdminPage(routes.admin.moderation())
  const t = await getTranslations('admin.moderation')
  const { items } = await getFlaggedContent({ status: 'pending' })

  return (
    <div>
      <h1 className="type-label">{t('dashboard')}</h1>
      <p className="mt-2 text-ink-muted">
        {t('blockedCount', { count: items.length })}
      </p>

      <div className="mt-8">
        <ModerationQueue items={items} decideAction={reviewModerationFlagAction} />
      </div>
    </div>
  )
}
