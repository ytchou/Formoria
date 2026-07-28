'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type {
  FeatureRequest,
  FeatureRequestStatus,
} from '@/lib/services/feature-requests'

/**
 * Exactly the fields this queue renders. The page projects rows down to this
 * shape so `submitted_by` — the submitter's auth.users id — never reaches the
 * client bundle, the same guard the corrections queue applies to visitor
 * hashes.
 */
export type FeatureRequestQueueItem = Pick<
  FeatureRequest,
  | 'id'
  | 'title'
  | 'category'
  | 'status'
  | 'voteCount'
  | 'adminNote'
  | 'mergedIntoId'
>

const STATUS_OPTIONS: readonly FeatureRequestStatus[] = [
  'open',
  'planned',
  'in_progress',
  'shipped',
  'declined',
  'duplicate',
]

type MutationResult = { error?: string } | undefined

type FeatureRequestsQueueProps = {
  requests: FeatureRequestQueueItem[]
  setStatusAction: (
    id: string,
    status: FeatureRequestStatus,
    adminNote: string,
  ) => Promise<MutationResult>
  mergeAction: (sourceId: string, targetId: string) => Promise<MutationResult>
}

type RowDraft = {
  status: FeatureRequestStatus
  note: string
  mergeTarget: string
}

export function FeatureRequestsQueue({
  requests,
  setStatusAction,
  mergeAction,
}: FeatureRequestsQueueProps) {
  const t = useTranslations('admin.featureRequests')
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [isPending, startTransition] = useTransition()

  function draftFor(item: FeatureRequestQueueItem): RowDraft {
    return (
      drafts[item.id] ?? {
        status: item.status,
        note: item.adminNote ?? '',
        mergeTarget: '',
      }
    )
  }

  function updateDraft(
    item: FeatureRequestQueueItem,
    patch: Partial<RowDraft>,
  ) {
    setDrafts((current) => ({
      ...current,
      [item.id]: { ...draftFor(item), ...patch },
    }))
  }

  function run(action: () => Promise<MutationResult>, successMessage: string) {
    startTransition(async () => {
      try {
        const result = await action()
        if (result?.error) {
          toast.error(t('toast.error'))
          return
        }
        toast.success(successMessage)
      } catch {
        toast.error(t('toast.error'))
      }
    })
  }

  if (requests.length === 0) {
    return <p className="type-empty-body mt-4">{t('empty')}</p>
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.request')}</TableHead>
            <TableHead>{t('table.category')}</TableHead>
            <TableHead>{t('table.votes')}</TableHead>
            <TableHead>{t('table.status')}</TableHead>
            <TableHead>{t('table.merge')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((item) => {
            const draft = draftFor(item)
            const mergeDisabled =
              isPending ||
              draft.mergeTarget === '' ||
              draft.mergeTarget === item.id ||
              item.mergedIntoId !== null

            return (
              <TableRow key={item.id}>
                <TableCell className="min-w-64 whitespace-normal font-medium">
                  <div className="space-y-1">
                    <span>{item.title}</span>
                    {item.mergedIntoId ? (
                      <Badge variant="ghost">{t('mergedInto')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{t(`category.${item.category}`)}</TableCell>
                <TableCell className="tabular-nums">{item.voteCount}</TableCell>
                <TableCell className="min-w-64 whitespace-normal">
                  <div className="space-y-2">
                    <NativeSelect
                      aria-label={t('statusLabel', { title: item.title })}
                      value={draft.status}
                      disabled={isPending}
                      onChange={(event) =>
                        updateDraft(item, {
                          status: event.currentTarget
                            .value as FeatureRequestStatus,
                        })
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {t(`status.${status}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Textarea
                      aria-label={t('noteLabel', { title: item.title })}
                      rows={2}
                      value={draft.note}
                      disabled={isPending}
                      onChange={(event) =>
                        updateDraft(item, { note: event.currentTarget.value })
                      }
                    />
                    <Button
                      variant="secondary"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () =>
                            setStatusAction(item.id, draft.status, draft.note),
                          t('toast.statusSaved'),
                        )
                      }
                    >
                      {t('saveStatus')}
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="min-w-64 whitespace-normal">
                  <div className="space-y-2">
                    <NativeSelect
                      aria-label={t('mergeLabel', { title: item.title })}
                      value={draft.mergeTarget}
                      disabled={isPending || item.mergedIntoId !== null}
                      onChange={(event) =>
                        updateDraft(item, {
                          mergeTarget: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="">{t('mergeTargetNone')}</option>
                      {requests.map((candidate) => (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                          // A self-merge is rejected by the service anyway;
                          // disabling the option means the moderator never gets
                          // that far.
                          disabled={candidate.id === item.id}
                        >
                          {candidate.title}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      variant="secondary"
                      disabled={mergeDisabled}
                      onClick={() =>
                        run(
                          () => mergeAction(item.id, draft.mergeTarget),
                          t('toast.merged'),
                        )
                      }
                    >
                      {t('mergeAction')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
