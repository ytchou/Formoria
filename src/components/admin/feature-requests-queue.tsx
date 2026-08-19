'use client'

import { useMemo, useState, useTransition } from 'react'
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
  | 'status'
  | 'voteCount'
  | 'adminNote'
  | 'mergedIntoId'
>

/**
 * `duplicate` is deliberately absent: it is reachable only through a merge,
 * which is the only write that also sets `merged_into_id`. Offering it here
 * would let an admin park a request in a status the public board renders with
 * no badge at all, while the row stays visible because it was never
 * tombstoned.
 */
const STATUS_OPTIONS: readonly FeatureRequestStatus[] = [
  'open',
  'planned',
  'in_progress',
  'shipped',
  'declined',
]

/**
 * Service codes -> copy. `admin.featureRequests` has no per-code strings, so
 * these reuse the existing `feedback.submit.errors.*` catalogue entries, which
 * already say "reload the board". Codes with no distinct copy (`database_error`,
 * `invalid_status`) fall through to the generic admin toast — an admin who
 * cannot tell those apart still has the same next action: retry.
 */
const MUTATION_ERROR_KEYS = {
  invalid_target: 'merged',
  already_merged: 'merged',
  not_found: 'not_found',
} as const

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
  const tErrors = useTranslations('feedback.submit.errors')
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [isPending, startTransition] = useTransition()

  // Built once for the whole table, not once per row: at the 200-request cap a
  // per-row list is 40k option nodes, re-created on every keystroke in a note
  // because the draft state lives here. Merged tombstones are excluded — the
  // service rejects them as targets, so offering one is an unwinnable retry.
  const mergeTargetOptions = useMemo(
    () =>
      requests
        .filter((candidate) => candidate.mergedIntoId === null)
        .map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        )),
    [requests],
  )

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

  function errorMessage(code: string): string {
    const key = MUTATION_ERROR_KEYS[code as keyof typeof MUTATION_ERROR_KEYS]
    return key ? tErrors(key) : t('toast.error')
  }

  function run(action: () => Promise<MutationResult>, successMessage: string) {
    startTransition(async () => {
      try {
        const result = await action()
        if (result?.error) {
          toast.error(errorMessage(result.error))
          return
        }
        toast.success(successMessage)
      } catch {
        toast.error(t('toast.error'))
      }
    })
  }

  if (requests.length === 0) {
    return <p className="type-body-sm mt-4">{t('empty')}</p>
  }

  return (
    <div className="mt-4 overflow-hidden rounded-[3px] border border-rule bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.request')}</TableHead>
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
                      {/* A merged row already holds `duplicate`, which is not
                          a settable status. Rendering it disabled keeps the
                          select showing the truth instead of silently
                          displaying the first option. */}
                      {STATUS_OPTIONS.includes(draft.status) ? null : (
                        <option value={draft.status} disabled>
                          {t(`status.${draft.status}`)}
                        </option>
                      )}
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
                      {/* The row's own request is still in this shared list; a
                          self-merge is blocked by the disabled merge button
                          below rather than by a per-row option list. */}
                      {mergeTargetOptions}
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
