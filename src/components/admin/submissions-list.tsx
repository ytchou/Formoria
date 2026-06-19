'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { BrandSubmission, SourceAttribution, SubmissionStatus } from '@/lib/types'
import type { BrandEnrichment } from '@/lib/services/brands'
import { StatusBadge } from './status-badge'
import { approveSubmissionAction, rejectSubmissionAction } from '@/app/admin/actions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type TabValue = 'all' | SubmissionStatus

type BrandSubmissionWithRisk = BrandSubmission & {
  moderationRiskLevel?: 'high' | 'medium' | 'clean'
  productTypeNote?: string | null
  brandEnrichment?: BrandEnrichment | null
}

type ReviewTaxonomyTag = {
  name: string
  nameZh: string | null
  slug: string
  category: string
}

const SOURCE_ATTRIBUTION_LABELS: Record<SourceAttribution, string> = {
  bought_product: 'I bought their product',
  saw_at_market: 'I saw them at a market or event',
  found_online: 'I found them online',
  friend_recommended: 'A friend recommended them',
  work_there: 'I work there or know the team',
}

const TAG_CATEGORIES = ['product_type', 'region', 'value', 'material', 'price_range']

function readinessBadgeClass(tone: 'green' | 'amber' | 'red' | 'grey') {
  switch (tone) {
    case 'green':
      return 'bg-[#EAF3E8] text-[#2D5A27]'
    case 'amber':
      return 'bg-amber-100 text-amber-800'
    case 'red':
      return 'bg-red-50 text-[#D94F3D]'
    case 'grey':
      return 'bg-[#F5F4F1] text-[#7C7570]'
  }
}

function ReadinessBadge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'green' | 'amber' | 'red' | 'grey'
}) {
  return (
    <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${readinessBadgeClass(tone)}`}>
      {children}
    </span>
  )
}

function getImageCount(enrichment: BrandEnrichment) {
  return (
    (enrichment.logoUrl ? 1 : 0) +
    (enrichment.heroImageUrl ? 1 : 0) +
    enrichment.productPhotos.length
  )
}

type StructuredSuggestedTags = {
  region?: string
  values?: string[]
}

function isStructuredSuggestedTags(value: unknown): value is StructuredSuggestedTags {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStructuredSuggestedTagSections(tags: StructuredSuggestedTags) {
  const region = typeof tags.region === 'string' ? tags.region : undefined
  const values = Array.isArray(tags.values)
    ? tags.values.filter((v): v is string => typeof v === 'string')
    : []

  return { region, values }
}

export function SubmissionsList({
  submissions,
  taxonomyTags,
}: {
  submissions: BrandSubmissionWithRisk[]
  taxonomyTags: ReviewTaxonomyTag[]
}) {
  const moderationT = useTranslations('admin.moderation')
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const tagsBySlug = useMemo(
    () => new Map(taxonomyTags.map((tag) => [tag.slug, tag])),
    [taxonomyTags]
  )

  const filtered =
    activeTab === 'all'
      ? submissions
      : submissions.filter((s) => s.status === activeTab)

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setRejectingId(null)
    setRejectNotes('')
    setError(null)
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      setError(null)
      setWarning(null)
      const result = await approveSubmissionAction(id)
      if (result?.error) setError(result.error)
      else if (result?.imageSyncWarning) {
        const { synced, failed } = result.imageSyncWarning
        setWarning(`Approved, but ${failed} of ${synced + failed} image(s) couldn't be downloaded and kept their source URL. Use "Re-sync images" in Brands after fixing the source.`)
      }
    })
  }

  function handleReject(id: string) {
    if (rejectingId !== id) {
      setRejectingId(id)
      return
    }
    startTransition(async () => {
      setError(null)
      const result = await rejectSubmissionAction(id, rejectNotes)
      if (result?.error) setError(result.error)
      else {
        setRejectingId(null)
        setRejectNotes('')
      }
    })
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const tabCounts = {
    all: submissions.length,
    pending: submissions.filter((s) => s.status === 'pending').length,
    approved: submissions.filter((s) => s.status === 'approved').length,
    rejected: submissions.filter((s) => s.status === 'rejected').length,
  }

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList>
          <TabsTrigger value="all">全部 ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="pending">
            待審核 ({tabCounts.pending})
          </TabsTrigger>
          <TabsTrigger value="approved">
            已核准 ({tabCounts.approved})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            已拒絕 ({tabCounts.rejected})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>品牌</TableHead>
              <TableHead className="w-16">分類</TableHead>
              <TableHead className="w-16">圖片</TableHead>
              <TableHead className="w-16">標籤</TableHead>
              <TableHead>提交者</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>來源</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((submission) => (
              <Fragment key={submission.id}>
                <TableRow
                  className="cursor-pointer hover:bg-[#F5F4F1]"
                  onClick={() => handleRowClick(submission.id)}
                >
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{submission.brandName}</span>
                      {submission.moderationRiskLevel === 'high' && (
                        <Badge className="bg-destructive text-white text-xs">{moderationT('riskHigh')}</Badge>
                      )}
                      {submission.moderationRiskLevel === 'medium' && (
                        <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-xs">{moderationT('riskMedium')}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {submission.brandEnrichment ? (
                      submission.brandEnrichment.productType.trim() ? (
                        <ReadinessBadge tone="green">✓</ReadinessBadge>
                      ) : (
                        <ReadinessBadge tone="amber">!</ReadinessBadge>
                      )
                    ) : (
                      <ReadinessBadge tone="grey">-</ReadinessBadge>
                    )}
                  </TableCell>
                  <TableCell>
                    {submission.brandEnrichment ? (
                      (() => {
                        const count = getImageCount(submission.brandEnrichment)
                        const tone = count >= 2 ? 'green' : count === 1 ? 'amber' : 'red'

                        return <ReadinessBadge tone={tone}>{count}</ReadinessBadge>
                      })()
                    ) : (
                      <ReadinessBadge tone="grey">-</ReadinessBadge>
                    )}
                  </TableCell>
                  <TableCell>
                    {submission.brandEnrichment ? (
                      (() => {
                        const count = submission.brandEnrichment.tagSlugs.length
                        const tone = count >= 3 ? 'green' : count >= 1 ? 'amber' : 'red'

                        return <ReadinessBadge tone={tone}>{count}</ReadinessBadge>
                      })()
                    ) : (
                      <ReadinessBadge tone="grey">-</ReadinessBadge>
                    )}
                  </TableCell>
                  <TableCell>{submission.submitterEmail}</TableCell>
                  <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                  <TableCell>
                    {submission.isBrandOwner ? (
                      <span className="inline-flex items-center rounded-full bg-[#2C1810] px-2 py-0.5 text-xs font-semibold text-white">
                        Owner
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-[#EAF3E8] px-2 py-0.5 text-xs font-semibold text-[#2D5A27]">
                        Community
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={submission.status} />
                  </TableCell>
                </TableRow>

                {expandedId === submission.id && (
                  <TableRow key={`${submission.id}-expanded`}>
                    <TableCell colSpan={8} className="bg-[#FAF7F4] p-6">
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            Review Readiness
                          </p>
                          {submission.brandEnrichment ? (
                            <div className="mt-2 space-y-2 text-sm">
                              <p>
                                <span className="font-medium">Product Type: </span>
                                {submission.brandEnrichment.productType.trim() ? (
                                  submission.brandEnrichment.productType
                                ) : (
                                  <span className="text-[#7C7570]">Not set</span>
                                )}
                              </p>
                              <p>
                                <span className="font-medium">Images: </span>
                                Logo {submission.brandEnrichment.logoUrl ? '✓' : '✗'} · Hero{' '}
                                {submission.brandEnrichment.heroImageUrl ? '✓' : '✗'} · Photos:{' '}
                                {submission.brandEnrichment.productPhotos.length}
                              </p>
                              <div>
                                <p className="font-medium">Tags:</p>
                                <div className="mt-1 space-y-1">
                                  {(() => {
                                    const groupedTags = new Map<string, string[]>()

                                    for (const category of TAG_CATEGORIES) {
                                      groupedTags.set(category, [])
                                    }

                                    for (const slug of submission.brandEnrichment.tagSlugs) {
                                      const tag = tagsBySlug.get(slug)
                                      if (tag) {
                                        const list = groupedTags.get(tag.category) ?? []
                                        list.push(tag.nameZh ?? tag.name)
                                        groupedTags.set(tag.category, list)
                                      }
                                    }

                                    const entries = Array.from(groupedTags.entries()).filter(
                                      ([, tags]) => tags.length > 0
                                    )

                                    if (entries.length === 0) {
                                      return (
                                        <p className="text-[#7C7570]">No tags assigned</p>
                                      )
                                    }

                                    return entries.map(([category, tags]) => (
                                      <p key={category}>
                                        <span className="capitalize">
                                          {category.replace('_', ' ')}:
                                        </span>{' '}
                                        {tags.join(', ')}
                                      </p>
                                    ))
                                  })()}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-[#7C7570]">
                              No brand record linked (legacy submission)
                            </p>
                          )}
                        </div>

                        {submission.description && (
                          <div>
                            <p className="text-sm font-medium text-[#7C7570]">
                              Description
                            </p>
                            <p className="mt-1 text-sm">
                              {submission.description}
                            </p>
                          </div>
                        )}

                        {submission.unifiedBusinessNumber && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">
                              統一編號：
                            </span>
                            <span className="font-mono">
                              {submission.unifiedBusinessNumber}
                            </span>
                          </div>
                        )}

                        {!submission.isBrandOwner && submission.sourceAttribution && (
                          <div>
                            <p className="text-sm font-medium text-[#7C7570]">
                              How do you know this brand?
                            </p>
                            <p className="mt-1 text-sm">
                              {SOURCE_ATTRIBUTION_LABELS[submission.sourceAttribution]}
                            </p>
                          </div>
                        )}

                        {submission.productTypeNote?.trim() && (
                          <div>
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                              Taxonomy gap
                            </span>
                            <p className="mt-1 text-sm text-[#7C7570]">
                              {submission.productTypeNote}
                            </p>
                          </div>
                        )}

                        {(() => {
                          const suggestedTags = submission.suggestedTags as unknown

                          if (Array.isArray(suggestedTags)) {
                            return suggestedTags.length > 0 && (
                              <div>
                                <p className="text-sm font-medium text-[#7C7570]">
                                  Suggested Tags
                                </p>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {suggestedTags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="inline-flex rounded-full bg-[#F5F4F1] px-2.5 py-0.5 text-xs font-medium text-[#7C7570]"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )
                          }

                          if (isStructuredSuggestedTags(suggestedTags)) {
                            const { region, values } =
                              getStructuredSuggestedTagSections(suggestedTags)

                            return (region || values.length > 0) && (
                              <div>
                                <p className="text-sm font-medium text-[#7C7570]">
                                  Suggested Tags
                                </p>
                                <div className="mt-1 space-y-1 text-sm">
                                  {region && <p>Region: {region}</p>}
                                  {values.length > 0 && (
                                    <p>Values: {values.join(', ')}</p>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          return null
                        })()}

                        {(submission.socialInstagram || submission.socialThreads || submission.socialFacebook) && (
                          <div>
                            <p className="text-sm font-medium text-[#7C7570]">
                              Social Links
                            </p>
                            <div className="mt-1 space-y-1 text-sm">
                              {submission.socialInstagram && (
                                <p><span className="capitalize">instagram:</span> {submission.socialInstagram}</p>
                              )}
                              {submission.socialThreads && (
                                <p><span className="capitalize">threads:</span> {submission.socialThreads}</p>
                              )}
                              {submission.socialFacebook && (
                                <p><span className="capitalize">facebook:</span> {submission.socialFacebook}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {error && (
                          <p className="text-sm text-[#D94F3D]">{error}</p>
                        )}
                        {warning && (
                          <p className="text-sm text-amber-600">{warning}</p>
                        )}

                        {submission.status === 'pending' && (
                          <div className="flex items-start gap-3">
                            <Button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleApprove(submission.id)
                              }}
                              disabled={isPending}
                              className="bg-[#E06B3F] hover:bg-[#c95d36]"
                            >
                              核准
                            </Button>
                            <div className="flex-1">
                              {rejectingId === submission.id && (
                                <Textarea
                                  placeholder="退件原因（選填）"
                                  value={rejectNotes}
                                  onChange={(e) =>
                                    setRejectNotes(e.target.value)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="mb-2"
                                />
                              )}
                              <Button
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReject(submission.id)
                                }}
                                disabled={isPending}
                              >
                                {rejectingId === submission.id
                                  ? '確認拒絕'
                                  : '拒絕'}
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
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-[#7C7570]"
                >
                  找不到提交記錄。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
