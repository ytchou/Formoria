import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { reviewModerationFlagFormAction } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireAdminPage } from '@/lib/auth/require-admin'
import { getFlaggedContent } from '@/lib/services/moderation'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.moderation')

  return {
    title: t('dashboard'),
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei',
  })
}

function truncateContent(value: string) {
  return value.length > 120 ? `${value.slice(0, 120)}...` : value
}

export default async function ReviewQueueModerationPage() {
  await requireAdminPage('/admin/moderation')
  const t = await getTranslations('admin.moderation')
  const { items } = await getFlaggedContent({ status: 'pending' })

  return (
    <div>
      <h1 className="type-page-title-large">{t('dashboard')}</h1>
      <p className="mt-2 text-muted-foreground">
        {t('blockedCount', { count: items.length })}
      </p>

      <div
        className={surfaceCardStyles({
          className: 'mt-8 overflow-hidden',
          padding: 'none',
        })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columnBrand')}</TableHead>
              <TableHead>{t('columnField')}</TableHead>
              <TableHead>{t('columnRule')}</TableHead>
              <TableHead>{t('columnExplanation')}</TableHead>
              <TableHead>{t('columnDetected')}</TableHead>
              <TableHead>{t('columnActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="min-w-56 font-medium">
                  {item.brandName}
                </TableCell>
                <TableCell>{item.fieldName}</TableCell>
                <TableCell className="type-metadata">
                  {t.has(`rules.${item.reason}`)
                    ? t(`rules.${item.reason}`)
                    : item.reason}
                </TableCell>
                <TableCell className="max-w-lg min-w-64">
                  {truncateContent(item.flaggedContent)}
                </TableCell>
                <TableCell>{formatDate(item.createdAt)}</TableCell>
                <TableCell className="min-w-56">
                  <div className="flex flex-wrap gap-2">
                    <form
                      action={reviewModerationFlagFormAction.bind(
                        null,
                        item.id,
                        'reviewed',
                      )}
                    >
                      <Button
                        type="submit"
                        variant="secondary"
                        size="compact"
                        className="min-h-12"
                      >
                        {t('markReviewed')}
                      </Button>
                    </form>
                    <form
                      action={reviewModerationFlagFormAction.bind(
                        null,
                        item.id,
                        'dismissed',
                      )}
                    >
                      <Button
                        type="submit"
                        variant="ghost"
                        size="compact"
                        className="min-h-12"
                      >
                        {t('dismiss')}
                      </Button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t('noBlockedContent')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
