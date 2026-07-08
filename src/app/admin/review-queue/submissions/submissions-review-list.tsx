'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  DENIAL_REASONS,
  type BrandSubmission,
  type DenialReason,
  type OtherUrl,
  type SubmissionIntent,
  type SourceAttribution,
  type SubmissionStatus,
} from '@/lib/types'
import type { EnrichedData } from '@/lib/types/enriched-data'
import { SubmissionStatusBadge } from '@/components/admin/status-badge'
import { rejectSubmissionAction } from '@/app/admin/actions'
import {
  approveSubmissionWithOverridesAction,
  type SubmissionApprovalOverrides,
} from './actions'
import { startCurationJobAction } from '@/app/admin/operations/actions'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

type TabValue = 'all' | SubmissionStatus
type IntentFilter = 'all' | SubmissionIntent

type BrandSubmissionWithRisk = BrandSubmission & {
  moderationRiskLevel?: 'high' | 'medium' | 'clean'
  productTypeNote?: string | null
  enriched_data?: EnrichedData | null
  brandSlug?: string | null
}

type OverrideForm = Required<Omit<SubmissionApprovalOverrides, 'otherUrls'>> & {
  otherUrls: OtherUrl[]
}

const SOURCE_ATTRIBUTION_LABELS: Record<SourceAttribution, string> = {
  bought_product: '我買過他們的產品',
  saw_at_market: '我在市集或活動看過',
  found_online: '我在網路上發現的',
  friend_recommended: '朋友推薦的',
  work_there: '我在那裡工作或認識團隊',
}

const PRODUCT_TYPE_EMPTY = '__none'
const BULK_DENIAL_REASONS = DENIAL_REASONS.filter((reason) => reason !== 'other')

type EnrichmentStatus = 'not_enriched' | 'enriched' | 'partially_enriched'
const GENERATED_GUEST_EMAIL_SUFFIX = '@guest.formoria.invalid'

function getSubmissionIntent(submission: Pick<BrandSubmission, 'intent' | 'isBrandOwner'>): SubmissionIntent {
  if (submission.intent) return submission.intent
  return submission.isBrandOwner ? 'owner_claim' : 'recommend'
}

function getSubmitterLabel(submission: Pick<BrandSubmission, 'submitterEmail'>) {
  return submission.submitterEmail.endsWith(GENERATED_GUEST_EMAIL_SUFFIX)
    ? '未提供'
    : submission.submitterEmail
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function readinessBadgeClass(tone: 'green' | 'amber' | 'red' | 'grey') {
  switch (tone) {
    case 'green':
      return 'bg-[#EAF3E8] text-[#2D5A27]'
    case 'amber':
      return 'bg-amber-50 text-amber-700'
    case 'red':
      return 'bg-red-50 text-destructive'
    case 'grey':
      return 'bg-[#F5F4F1] text-muted-foreground'
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

function AutoBadge() {
  return (
    <Badge variant="outline" className="border-dashed bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
      auto
    </Badge>
  )
}

function FieldLabel({
  children,
  auto,
}: {
  children: React.ReactNode
  auto?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <span>{children}</span>
      {auto && <AutoBadge />}
    </div>
  )
}

function EnrichedCard({
  children,
  auto,
}: {
  children: React.ReactNode
  auto?: boolean
}) {
  return (
    <Card className={auto ? 'border-dashed bg-background shadow-none' : 'bg-white shadow-none'}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  )
}

function hasText(value: string | undefined) {
  return (value ?? '').trim() !== ''
}

export function getEnrichmentStatus(
  enriched_data: EnrichedData | null,
  heroImageUrl?: string | null
): EnrichmentStatus {
  if (!enriched_data) {
    return hasText(heroImageUrl ?? undefined) ? 'partially_enriched' : 'not_enriched'
  }

  const hasAllKeyFields =
    hasText(enriched_data.description) &&
    (hasText(enriched_data.heroImageUrl) || hasText(heroImageUrl ?? undefined)) &&
    hasText(enriched_data.productType)

  return hasAllKeyFields ? 'enriched' : 'partially_enriched'
}

function getImageCount(
  enrichedData: EnrichedData | null,
  heroImageUrl?: string | null
) {
  const hasHeroImage = hasText(enrichedData?.heroImageUrl) || hasText(heroImageUrl ?? undefined)
  return hasHeroImage ? 1 : 0
}


function createOverrideForm(submission: BrandSubmissionWithRisk): OverrideForm {
  return {
    description: submission.description ?? '',
    productType: submission.enriched_data?.productType ?? '',
    purchaseWebsite: submission.purchaseWebsite ?? '',
    purchasePinkoi: submission.purchasePinkoi ?? '',
    purchaseShopee: submission.purchaseShopee ?? '',
    socialInstagram: submission.socialInstagram ?? '',
    socialThreads: submission.socialThreads ?? '',
    socialFacebook: submission.socialFacebook ?? '',
    otherUrls: submission.otherUrls ?? [],
  }
}

type StructuredSuggestedTags = {
  values?: string[]
}

function isStructuredSuggestedTags(value: unknown): value is StructuredSuggestedTags {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStructuredSuggestedTagSections(tags: StructuredSuggestedTags) {
  const values = Array.isArray(tags.values)
    ? tags.values.filter((v): v is string => typeof v === 'string')
    : []

  return { values }
}

export function SubmissionsReviewList({
  submissions,
}: {
  submissions: BrandSubmissionWithRisk[]
}) {
  const moderationT = useTranslations('admin.moderation')
  const denialReasonsT = useTranslations('admin.submissions.denialReasons')
  const enrichT = useTranslations('admin.enrichment')
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [intentFilter, setIntentFilter] = useState<IntentFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<DenialReason | ''>('')
  const [rejectNotes, setRejectNotes] = useState('')
  const [isBulkRejecting, setIsBulkRejecting] = useState(false)
  const [bulkRejectReason, setBulkRejectReason] = useState<DenialReason | ''>('')
  const [bulkRejectError, setBulkRejectError] = useState<string | null>(null)
  const [overridesById, setOverridesById] = useState<Record<string, OverrideForm>>({})
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isEnriching, startEnrichTransition] = useTransition()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const router = useRouter()

  const statusFiltered =
    activeTab === 'all'
      ? submissions
      : submissions.filter((s) => s.status === activeTab)
  const filtered =
    intentFilter === 'all'
      ? statusFiltered
      : statusFiltered.filter((submission) => getSubmissionIntent(submission) === intentFilter)

  function handleRowClick(submission: BrandSubmissionWithRisk) {
    setExpandedId((prev) => (prev === submission.id ? null : submission.id))
    setOverridesById((prev) => (
      prev[submission.id]
        ? prev
        : { ...prev, [submission.id]: createOverrideForm(submission) }
    ))
    setRejectingId(null)
    setRejectReason('')
    setRejectNotes('')
    setError(null)
  }

  function updateOverride<K extends keyof OverrideForm>(
    id: string,
    key: K,
    value: OverrideForm[K]
  ) {
    setOverridesById((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value,
      },
    }))
  }

  function updateOtherUrl(id: string, index: number, key: keyof OtherUrl, value: string) {
    const current = overridesById[id]?.otherUrls ?? []
    updateOverride(
      id,
      'otherUrls',
      current.map((link, linkIndex) => (
        linkIndex === index ? { ...link, [key]: value } : link
      ))
    )
  }

  function addOtherUrl(id: string) {
    updateOverride(id, 'otherUrls', [...(overridesById[id]?.otherUrls ?? []), { label: '', url: '' }])
  }

  function removeOtherUrl(id: string, index: number) {
    updateOverride(
      id,
      'otherUrls',
      (overridesById[id]?.otherUrls ?? []).filter((_, linkIndex) => linkIndex !== index)
    )
  }

  function handleApprove(submission: BrandSubmissionWithRisk) {
    startTransition(async () => {
      setError(null)
      const result = await approveSubmissionWithOverridesAction(
        submission.id,
        overridesById[submission.id] ?? createOverrideForm(submission)
      )
      if (result?.error) setError(result.error)
    })
  }

  function handleReject(id: string) {
    if (rejectingId !== id) {
      setRejectingId(id)
      setRejectReason('')
      setRejectNotes('')
      setError(null)
      return
    }
    if (!rejectReason) {
      setError('請選擇拒絕原因')
      return
    }
    if (rejectReason === 'other' && !rejectNotes.trim()) {
      setError('請填寫補充說明')
      return
    }
    startTransition(async () => {
      setError(null)
      const result = await rejectSubmissionAction(id, rejectReason, rejectNotes)
      if (result?.error) setError(result.error)
      else {
        setRejectingId(null)
        setRejectReason('')
        setRejectNotes('')
      }
    })
  }

  const tabCounts = useMemo(() => ({
    all: submissions.length,
    pending: submissions.filter((s) => s.status === 'pending').length,
    approved: submissions.filter((s) => s.status === 'approved').length,
    rejected: submissions.filter((s) => s.status === 'rejected').length,
  }), [submissions])
  const intentCounts = useMemo(() => ({
    all: submissions.length,
    recommend: submissions.filter((submission) => getSubmissionIntent(submission) === 'recommend').length,
    owner_claim: submissions.filter((submission) => getSubmissionIntent(submission) === 'owner_claim').length,
  }), [submissions])

  function handleBulkApprove() {
    const pendingSelected = filtered.filter(
      (s) => s.status === 'pending' && selectedIds.has(s.id)
    )
    if (pendingSelected.length === 0) return
    if (!confirm(`確定要核准 ${pendingSelected.length} 筆提交？`)) return
    startTransition(async () => {
      setError(null)
      for (const submission of pendingSelected) {
        const result = await approveSubmissionWithOverridesAction(
          submission.id,
          overridesById[submission.id] ?? createOverrideForm(submission)
        )
        if (result?.error) {
          setError(`${submission.brandName}: ${result.error}`)
          return
        }
      }
      setSelectedIds(new Set())
    })
  }

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) {
        setIsBulkRejecting(false)
        setBulkRejectReason('')
        setBulkRejectError(null)
      }
      return next
    })
  }

  function toggleSelectAll() {
    const enrichable = filtered
    const allEnrichableSelected = enrichable.length > 0 && enrichable.every(s => selectedIds.has(s.id))
    if (allEnrichableSelected) {
      setSelectedIds(new Set())
      setIsBulkRejecting(false)
      setBulkRejectReason('')
      setBulkRejectError(null)
    } else {
      setSelectedIds(new Set(enrichable.map(s => s.id)))
    }
  }

  function handleBulkReject() {
    if (isPending) return
    const submissionIds = [...selectedIds]
    if (submissionIds.length === 0) return

    if (!isBulkRejecting) {
      setIsBulkRejecting(true)
      setBulkRejectReason('')
      setBulkRejectError(null)
      return
    }

    if (!bulkRejectReason) {
      setBulkRejectError('請選擇拒絕原因')
      return
    }

    startTransition(async () => {
      setBulkRejectError(null)
      const results = await Promise.all(
        submissionIds.map((submissionId) =>
          rejectSubmissionAction(submissionId, bulkRejectReason, '')
        )
      )
      const failed = results.find((result) => result?.error)
      if (failed?.error) {
        setBulkRejectError(failed.error)
        return
      }
      setSelectedIds(new Set())
      setIsBulkRejecting(false)
      setBulkRejectReason('')
      router.refresh()
    })
  }

  function handleEnrichSelected() {
    if (isEnriching) return
    const submissionIds = [...selectedIds]
    if (submissionIds.length === 0) return

    startEnrichTransition(async () => {
      const result = await startCurationJobAction('enrich', { submissionIds }, false)
      if ('error' in result) {
        toast.error(result.error)
        return
      }

      if ('queued' in result) {
        toast.info(result.message)
        setSelectedIds(new Set())
        router.refresh()
        return
      }

      const { summary } = result
      toast.success(
        enrichT('complete', { success: summary.success, skipped: summary.skipped, failed: summary.failed })
      )
      setSelectedIds(new Set())
      router.refresh()
    })
  }

  const enrichableFiltered = filtered
  const selectedCount = selectedIds.size
  const allSelected = enrichableFiltered.length > 0 && enrichableFiltered.every(s => selectedIds.has(s.id))
  const someSelected = selectedCount > 0 && !allSelected

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as TabValue)
          setIntentFilter('all')
          setSelectedIds(new Set())
          setIsBulkRejecting(false)
          setBulkRejectReason('')
          setBulkRejectError(null)
        }}
      >
        <div className="flex items-center justify-between gap-4">
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

          <div className="flex items-center gap-2">
            <Select
              value={intentFilter}
              onValueChange={(value) => setIntentFilter(value as IntentFilter)}
            >
              <SelectTrigger aria-label="提交意圖篩選" className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">全部提交 ({intentCounts.all})</SelectItem>
                <SelectItem value="recommend">推薦提交 ({intentCounts.recommend})</SelectItem>
                <SelectItem value="owner_claim">品牌主開始申請 ({intentCounts.owner_claim})</SelectItem>
              </SelectContent>
            </Select>
            {selectedCount > 0 && (
              <span className="text-sm text-muted-foreground">
                已選擇 {selectedCount} 筆
              </span>
            )}
            {bulkRejectError && (
              <span className="text-sm text-destructive">{bulkRejectError}</span>
            )}
            <Button
              size="sm"
              onClick={handleEnrichSelected}
              disabled={selectedCount === 0 || isEnriching}
            >
              {isEnriching ? '抓取中...' : '抓取資料'}
            </Button>
            <Button
              size="sm"
              variant="cta"
              onClick={handleBulkApprove}
              disabled={selectedCount === 0 || isPending}
            >
              核准
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkReject}
              disabled={
                selectedCount === 0 ||
                isPending ||
                (isBulkRejecting && !bulkRejectReason)
              }
            >
              {isBulkRejecting ? '確認批次拒絕' : '拒絕'}
            </Button>
          </div>
        </div>
        {isBulkRejecting && selectedCount > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
            <div className="min-w-[240px] flex-1 space-y-2">
              <label className="text-sm font-semibold text-foreground">
                批次拒絕原因 <span className="text-destructive">*</span>
              </label>
              <Select
                value={bulkRejectReason}
                onValueChange={(value) =>
                  setBulkRejectReason(value as DenialReason)
                }
              >
                <SelectTrigger
                  aria-label="批次拒絕原因"
                  className="h-12 w-full focus-visible:ring-2 focus-visible:ring-[#2F5D50]/60"
                >
                  <SelectValue placeholder="選擇拒絕原因" />
                </SelectTrigger>
                <SelectContent align="start">
                  {BULK_DENIAL_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {denialReasonsT(reason)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Tabs>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </div>
              </TableHead>
              <TableHead>品牌</TableHead>
              <TableHead className="w-16">分類</TableHead>
              <TableHead className="w-16">圖片</TableHead>
              <TableHead>來源</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>資料充實</TableHead>
              <TableHead>提交者</TableHead>
              <TableHead>日期</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((submission) => {
              const form = overridesById[submission.id] ?? createOverrideForm(submission)
              const hasEnrichment = Boolean(submission.enriched_data)
              const submissionIntent = getSubmissionIntent(submission)

              return (
                <Fragment key={submission.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-[#F5F4F1]"
                    onClick={() => handleRowClick(submission)}
                  >
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(submission.id)}
                          onCheckedChange={() => toggleSelection(submission.id)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{submission.brandName}</span>
                        {submission.moderationRiskLevel === 'high' && (
                          <Badge className="bg-destructive text-xs text-white">{moderationT('riskHigh')}</Badge>
                        )}
                        {submission.moderationRiskLevel === 'medium' && (
                          <Badge className="border border-amber-200 bg-amber-50 text-xs text-amber-700">{moderationT('riskMedium')}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {submission.enriched_data ? (
                        (submission.enriched_data.productType ?? '').trim() ? (
                          <ReadinessBadge tone="green">✓</ReadinessBadge>
                        ) : (
                          <ReadinessBadge tone="amber">!</ReadinessBadge>
                        )
                      ) : (
                        <ReadinessBadge tone="grey">-</ReadinessBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const count = getImageCount(
                          submission.enriched_data ?? null,
                          submission.heroImageUrl
                        )
                        const tone = count >= 2 ? 'green' : count === 1 ? 'amber' : submission.enriched_data ? 'red' : 'grey'

                        return <ReadinessBadge tone={tone}>{submission.enriched_data || count > 0 ? count : '-'}</ReadinessBadge>
                      })()}
                    </TableCell>
                    <TableCell>
                      {submissionIntent === 'owner_claim' ? (
                        <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-white">
                          品牌主開始申請
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#EAF3E8] px-2 py-0.5 text-xs font-semibold text-[#2D5A27]">
                          推薦提交
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SubmissionStatusBadge status={submission.status} />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const status = getEnrichmentStatus(submission.enriched_data ?? null, submission.heroImageUrl)
                        if (status === 'enriched') {
                          return <ReadinessBadge tone="green">已完成</ReadinessBadge>
                        }
                        if (status === 'partially_enriched') {
                          return <ReadinessBadge tone="amber">部分</ReadinessBadge>
                        }
                        return <ReadinessBadge tone="grey">未處理</ReadinessBadge>
                      })()}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">{getSubmitterLabel(submission)}</TableCell>
                    <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                    <TableCell className="text-right">
                      {submission.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="cta"
                            onClick={() => handleApprove(submission)}
                            disabled={isPending}
                          >
                            核准
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!confirm('確定要拒絕此提交？')) return
                              startTransition(async () => {
                                setError(null)
                                const result = await rejectSubmissionAction(submission.id, 'other', '')
                                if (result?.error) setError(result.error)
                              })
                            }}
                            disabled={isPending}
                            className="h-7 px-2 text-xs"
                          >
                            拒絕
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>

                  {expandedId === submission.id && (
                    <TableRow key={`${submission.id}-expanded`}>
                      <TableCell colSpan={11} className="bg-background p-6">
                        <div className="space-y-4">
                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>品牌描述</FieldLabel>
                              <Textarea
                                value={form.description ?? ''}
                                onChange={(e) => updateOverride(submission.id, 'description', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="品牌描述"
                                className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                              />
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>產品類型</FieldLabel>
                              <Select
                                value={form.productType || PRODUCT_TYPE_EMPTY}
                                onValueChange={(value) =>
                                  updateOverride(
                                    submission.id,
                                    'productType',
                                    value === PRODUCT_TYPE_EMPTY ? '' : value
                                  )
                                }
                              >
                                <SelectTrigger
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                >
                                  <SelectValue placeholder="選擇產品類型" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={PRODUCT_TYPE_EMPTY}>未設定</SelectItem>
                                  {form.productType &&
                                    !PRODUCT_TYPE_CATEGORIES.some((c) => c.slug === form.productType) && (
                                      <SelectItem value={form.productType}>
                                        {form.productType}
                                      </SelectItem>
                                    )}
                                  {PRODUCT_TYPE_CATEGORIES.map((category) => (
                                    <SelectItem key={category.slug} value={category.slug}>
                                      {`${category.nameZh} (${category.name})`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>購買連結</FieldLabel>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Input
                                  type="url"
                                  placeholder="官網連結"
                                  value={form.purchaseWebsite ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'purchaseWebsite', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                                <Input
                                  type="url"
                                  placeholder="Pinkoi 連結"
                                  value={form.purchasePinkoi ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'purchasePinkoi', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                                <Input
                                  type="url"
                                  placeholder="蝦皮連結"
                                  value={form.purchaseShopee ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'purchaseShopee', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                              </div>
                              <div className="space-y-2">
                                {form.otherUrls.map((link, index) => (
                                  <div key={`${index}-${link.label}`} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                                    <Input
                                      placeholder="標籤"
                                      value={link.label}
                                      onChange={(e) => updateOtherUrl(submission.id, index, 'label', e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                    />
                                    <Input
                                      type="url"
                                      placeholder="連結"
                                      value={link.url}
                                      onChange={(e) => updateOtherUrl(submission.id, index, 'url', e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        removeOtherUrl(submission.id, index)
                                      }}
                                    >
                                      移除
                                    </Button>
                                  </div>
                                ))}
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    addOtherUrl(submission.id)
                                  }}
                                >
                                  新增連結
                                </Button>
                              </div>
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>社群連結</FieldLabel>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Input
                                  type="url"
                                  placeholder="Instagram 連結"
                                  value={form.socialInstagram ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'socialInstagram', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                                <Input
                                  type="url"
                                  placeholder="Threads 連結"
                                  value={form.socialThreads ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'socialThreads', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                                <Input
                                  type="url"
                                  placeholder="Facebook 連結"
                                  value={form.socialFacebook ?? ''}
                                  onChange={(e) => updateOverride(submission.id, 'socialFacebook', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={hasEnrichment ? 'border-dashed bg-white/80' : undefined}
                                />
                              </div>
                            </div>
                          </EnrichedCard>

                          {(() => {
                            const hasImages = Boolean(
                              submission.enriched_data ||
                              submission.heroImageUrl
                            )

                            return hasImages ? (
                              <EnrichedCard auto>
                                <div className="space-y-3">
                                  <FieldLabel auto>主圖 / 產品圖片</FieldLabel>
                                  <div className="grid gap-3 sm:grid-cols-4">
                                    {(submission.enriched_data?.heroImageUrl || submission.heroImageUrl) && (
                                      <a
                                        href={submission.enriched_data?.heroImageUrl || submission.heroImageUrl || ''}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block overflow-hidden rounded-md border border-dashed bg-white"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={submission.enriched_data?.heroImageUrl || submission.heroImageUrl || ''}
                                          alt={`${submission.brandName} hero`}
                                          className="aspect-square w-full object-cover"
                                        />
                                        <span className="block px-2 py-1 text-xs text-muted-foreground">主圖</span>
                                      </a>
                                    )}
                                  </div>
                                  {!submission.heroImageUrl &&
                                    !submission.enriched_data?.heroImageUrl && (
                                      <p className="text-sm text-muted-foreground">尚無圖片</p>
                                    )}
                                </div>
                              </EnrichedCard>
                            ) : null
                          })()}

                          {submissionIntent === 'recommend' && submission.sourceAttribution && (
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                你怎麼知道這個品牌？
                              </p>
                              <p className="mt-1 text-sm">
                                {SOURCE_ATTRIBUTION_LABELS[submission.sourceAttribution]}
                              </p>
                            </div>
                          )}

                          {submissionIntent === 'owner_claim' ? (
                            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                              核准後，系統會寄送品牌認領邀請給提交者；後續的證明審核會在認領申請佇列處理。
                            </div>
                          ) : null}

                          {submission.productTypeNote?.trim() && (
                            <div>
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                                分類缺口
                              </span>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {submission.productTypeNote}
                              </p>
                            </div>
                          )}

                          {(() => {
                            const suggestedTags = submission.suggestedTags as unknown

                            if (Array.isArray(suggestedTags)) {
                              return suggestedTags.length > 0 && (
                                <div>
                                  <p className="text-sm font-medium text-muted-foreground">
                                    建議標籤
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    {suggestedTags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="inline-flex rounded-full bg-[#F5F4F1] px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )
                            }

                            if (isStructuredSuggestedTags(suggestedTags)) {
                              const { values } =
                                getStructuredSuggestedTagSections(suggestedTags)

                              return values.length > 0 && (
                                <div>
                                  <p className="text-sm font-medium text-muted-foreground">
                                    建議標籤
                                  </p>
                                  <div className="mt-1 space-y-1 text-sm">
                                    {values.length > 0 && (
                                      <p>特色：{values.join(', ')}</p>
                                    )}
                                  </div>
                                </div>
                              )
                            }

                            return null
                          })()}

                          {error && (
                            <p className="text-sm text-destructive">{error}</p>
                          )}
                          {submission.status === 'pending' && (
                            <div className="flex items-start gap-3">
                              <Button
                                variant="cta"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleApprove(submission)
                                }}
                                disabled={isPending}
                              >
                                核准
                              </Button>
                              <div className="flex-1">
                                {rejectingId === submission.id && (
                                  <div className="mb-2 space-y-3">
                                    <div className="space-y-2">
                                      <label className="text-sm font-semibold text-foreground">
                                        拒絕原因 <span className="text-destructive">*</span>
                                      </label>
                                      <Select
                                        value={rejectReason}
                                        onValueChange={(value) =>
                                          setRejectReason(value as DenialReason)
                                        }
                                      >
                                        <SelectTrigger
                                          aria-label="拒絕原因"
                                          onClick={(e) => e.stopPropagation()}
                                          className="h-12 w-full focus-visible:ring-2 focus-visible:ring-[#2F5D50]/60"
                                        >
                                          <SelectValue placeholder="選擇拒絕原因" />
                                        </SelectTrigger>
                                        <SelectContent align="start">
                                          {DENIAL_REASONS.map((reason) => (
                                            <SelectItem key={reason} value={reason}>
                                              {denialReasonsT(reason)}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Textarea
                                      placeholder={
                                        rejectReason === 'other'
                                          ? '補充說明（必填）'
                                          : '補充說明（選填）'
                                      }
                                      value={rejectNotes}
                                      onChange={(e) =>
                                        setRejectNotes(e.target.value)
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                )}
                                <Button
                                  variant="destructive"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleReject(submission.id)
                                  }}
                                  disabled={isPending || (rejectingId === submission.id && !rejectReason)}
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
              )
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="py-8 text-center text-muted-foreground"
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
