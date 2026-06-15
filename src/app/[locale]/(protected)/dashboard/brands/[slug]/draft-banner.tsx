'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { discardDraftAction, publishDraftAction } from './actions'

type ActionState = {
  success?: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

type DraftBannerProps = {
  slug: string
  draftUpdatedAt: string | null
}

const initialState: ActionState = undefined

function ActionFeedback({
  state,
  submittedForReviewMessage,
}: {
  state: ActionState
  submittedForReviewMessage: string
}) {
  const fieldErrors = state?.fieldErrors ? Object.values(state.fieldErrors) : []
  const messages = [state?.error, ...fieldErrors].filter(
    (message): message is string => Boolean(message),
  )

  if (state?.success === true && state.message === 'brandEditSubmittedForReview') {
    return (
      <div className="rounded-lg border border-[var(--verified-green)] bg-[var(--verified-green-bg)] px-4 py-3 text-sm font-medium text-[var(--verified-green)]">
        {submittedForReviewMessage}
      </div>
    )
  }

  if (messages.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  )
}

export function DraftBanner({ slug, draftUpdatedAt }: DraftBannerProps) {
  const t = useTranslations('dashboard.manage')
  const pendingEditsT = useTranslations('admin.pendingEdits')
  const [publishState, publishFormAction, publishPending] = useActionState(
    publishDraftAction,
    initialState,
  )
  const [discardState, discardFormAction, discardPending] = useActionState(
    discardDraftAction,
    initialState,
  )

  return (
    <Card className="shadow-none" data-draft-updated-at={draftUpdatedAt ?? undefined}>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="font-heading text-base font-semibold text-foreground">
            {t('draftPendingTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('draftPendingHint')}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-12 sm:min-w-24"
            render={
              <Link
                href={`/brands/${slug}?preview=1`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            {t('draftPreview')}
          </Button>

          <form action={publishFormAction}>
            <input type="hidden" name="brandSlug" value={slug} />
            <Button
              type="submit"
              className="h-12 w-full sm:min-w-24"
              disabled={publishPending}
            >
              {t('draftPublish')}
            </Button>
          </form>

          <form
            action={discardFormAction}
            onSubmit={(event) => {
              if (!window.confirm(t('draftDiscardConfirm'))) {
                event.preventDefault()
              }
            }}
          >
            <input type="hidden" name="brandSlug" value={slug} />
            <Button
              type="submit"
              variant="destructive"
              className="h-12 w-full sm:min-w-24"
              disabled={discardPending}
            >
              {t('draftDiscard')}
            </Button>
          </form>
        </div>

        <ActionFeedback
          state={publishState}
          submittedForReviewMessage={pendingEditsT('brandEditSubmittedForReview')}
        />
        <ActionFeedback
          state={discardState}
          submittedForReviewMessage={pendingEditsT('brandEditSubmittedForReview')}
        />
      </CardContent>
    </Card>
  )
}
