'use client'

import { Fragment, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type {
  OriginEvidence,
  OriginEvidenceDecision,
  OriginEvidenceStatus,
} from '@/lib/services/origin-evidence'
import { cn } from '@/lib/utils'

type TabValue = 'all' | OriginEvidenceStatus
type ReviewAction = (
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  tierAction?: 'strip_declaration',
) => Promise<{ error?: string } | undefined>

const TAB_VALUES: TabValue[] = ['all', 'pending', 'approved', 'rejected']

const STATUS_CLASSES: Record<OriginEvidenceStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  approved: 'bg-verified-green-bg text-verified-green',
  rejected: 'bg-cta/10 text-destructive',
}

export function EvidenceQueue({
  evidence,
  reviewAction,
}: {
  evidence: OriginEvidence[]
  reviewAction?: ReviewAction
}) {
  const t = useTranslations('admin.evidence')
  const locale = useLocale()
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [stripDeclaration, setStripDeclaration] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = activeTab === 'all'
    ? evidence
    : evidence.filter((item) => item.status === activeTab)

  const tabCounts: Record<TabValue, number> = {
    all: evidence.length,
    pending: evidence.filter((item) => item.status === 'pending').length,
    approved: evidence.filter((item) => item.status === 'approved').length,
    rejected: evidence.filter((item) => item.status === 'rejected').length,
  }

  function handleRowClick(id: string) {
    setExpandedId((current) => (current === id ? null : id))
    setReviewerNotes('')
    setStripDeclaration(false)
    setError(null)
  }

  function handleReview(item: OriginEvidence, decision: OriginEvidenceDecision) {
    const notes = reviewerNotes.trim()
    if (decision === 'rejected' && !notes) {
      setError(t('errors.notesRequired'))
      return
    }
    if (decision === 'approved' && stripDeclaration && !notes) {
      setError(t('errors.notesRequired'))
      return
    }

    startTransition(async () => {
      setError(null)
      try {
        const tierAction = decision === 'approved' &&
          item.brandMitStatus === 'declared' &&
          stripDeclaration
          ? 'strip_declaration'
          : undefined
        const result = await reviewAction?.(item.id, decision, notes, tierAction)
        if (result?.error) {
          setError(t('errors.generic'))
          return
        }
        setReviewerNotes('')
        setStripDeclaration(false)
      } catch {
        setError(t('errors.generic'))
      }
    })
  }

  function formatDate(date: string) {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(date))
  }

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
      >
        <TabsList>
          {TAB_VALUES.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)} ({tabCounts[tab]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.brand')}</TableHead>
              <TableHead>{t('table.stance')}</TableHead>
              <TableHead>{t('table.product')}</TableHead>
              <TableHead>{t('table.date')}</TableHead>
              <TableHead>{t('table.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <Fragment key={item.id}>
                <TableRow
                  aria-expanded={expandedId === item.id}
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => handleRowClick(item.id)}
                >
                  <TableCell className="font-medium">
                    {item.brandName ?? t('unknownBrand')}
                  </TableCell>
                  <TableCell>
                    {expandedId === item.id ? null : t(`stances.${item.stance}`)}
                  </TableCell>
                  <TableCell>{item.productName ?? t('notProvided')}</TableCell>
                  <TableCell>{formatDate(item.createdAt)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 type-field-label',
                        STATUS_CLASSES[item.status],
                      )}
                    >
                      {t(`tabs.${item.status}`)}
                    </span>
                  </TableCell>
                </TableRow>

                {expandedId === item.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-background p-6 whitespace-normal">
                      <div className="space-y-5">
                        <dl className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <dt className="type-metadata">{t('fields.stance')}</dt>
                            <dd className="mt-1 text-sm">{t(`stances.${item.stance}`)}</dd>
                          </div>
                          <div>
                            <dt className="type-metadata">{t('fields.product')}</dt>
                            <dd className="mt-1 text-sm">
                              {item.productName ?? t('notProvided')}
                            </dd>
                          </div>
                          <div>
                            <dt className="type-metadata">{t('fields.sourceType')}</dt>
                            <dd className="mt-1 text-sm">
                              {t(`sourceTypes.${item.sourceType}`)}
                            </dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="type-metadata">{t('fields.notes')}</dt>
                            <dd className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</dd>
                          </div>
                        </dl>

                        {item.photos.some((photo) => photo.signedUrl) && (
                          <div>
                            <p className="type-metadata">{t('fields.photos')}</p>
                            <div className="mt-2 flex flex-wrap gap-3">
                              {item.photos.map((photo, index) => photo.signedUrl ? (
                                <a
                                  key={photo.path}
                                  href={photo.signedUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element -- Private signed evidence URLs are short-lived review thumbnails. */}
                                  <img
                                    src={photo.signedUrl}
                                    alt={t('photoAlt', { index: index + 1 })}
                                    className="h-20 w-20 rounded-md border border-border object-cover"
                                  />
                                </a>
                              ) : null)}
                            </div>
                          </div>
                        )}

                        {item.reviewerNotes && (
                          <div>
                            <p className="type-metadata">{t('fields.reviewerNotes')}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm">
                              {item.reviewerNotes}
                            </p>
                          </div>
                        )}

                        {error && (
                          <p className="text-sm text-destructive" role="alert">
                            {error}
                          </p>
                        )}

                        {item.status === 'pending' && (
                          <div
                            className="max-w-xl space-y-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Textarea
                              aria-label={t('fields.reviewerNotes')}
                              placeholder={t('reviewerNotesPlaceholder')}
                              value={reviewerNotes}
                              onChange={(event) => {
                                setReviewerNotes(event.target.value)
                                setError(null)
                              }}
                              disabled={isPending}
                            />

                            {item.brandMitStatus === 'declared' && item.stance === 'contradicts' && (
                              <Label className="min-h-12 cursor-pointer gap-3 text-sm">
                                <Checkbox
                                  checked={stripDeclaration}
                                  onCheckedChange={setStripDeclaration}
                                  disabled={isPending}
                                />
                                <span>{t('stripDeclaration')}</span>
                              </Label>
                            )}

                            <div className="flex flex-wrap gap-3">
                              <Button
                                onClick={() => handleReview(item, 'approved')}
                                disabled={isPending}
                              >
                                {t('actions.approve')}
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => handleReview(item, 'rejected')}
                                disabled={isPending}
                              >
                                {t('actions.reject')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}

            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t('noEvidence')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
