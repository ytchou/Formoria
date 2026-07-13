'use client'

import { Fragment, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import {
  approveClaimAction,
  rejectClaimAction,
} from '@/app/admin/actions'
import { StatusBadge } from '@/components/admin/status-badge'
import { Button } from '@/components/ui/button'
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
import { PROOF_TYPE_I18N_KEYS, type ProofEvidence } from '@/lib/services/claim-proofs'
import type { ClaimRequest } from '@/lib/services/claim-requests'

type TabValue = 'all' | ClaimRequest['status']
type SignedProofEvidence = ProofEvidence & { signedUrl?: string }
type ClaimRequestWithSignedProof = Omit<ClaimRequest, 'proofEvidence'> & {
  proofEvidence: SignedProofEvidence[]
}
type RejectActionTarget =
  | { kind: 'claim'; id: string }
  | null
type RejectReasonKey =
  | 'insufficientProof'
  | 'proofMismatch'
  | 'emailUnverified'
  | 'alreadyClaimed'
  | 'screenshotInsufficient'
  | 'docMismatch'
  | 'proofInauthentic'
  | 'needMoreEvidence'

const REJECT_REASON_KEYS: RejectReasonKey[] = [
  'insufficientProof',
  'proofMismatch',
  'emailUnverified',
  'alreadyClaimed',
  'screenshotInsufficient',
  'docMismatch',
  'proofInauthentic',
  'needMoreEvidence',
]

function isClickableProofUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

export function ClaimRequestsList({
  claimRequests,
}: {
  claimRequests: ClaimRequestWithSignedProof[]
}) {
  const proofTypesT = useTranslations('brands.claimCta.proofTypes')
  const adminClaimT = useTranslations('admin.claimRequests')
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<RejectActionTarget>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [rejectReasonPreset, setRejectReasonPreset] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered =
    activeTab === 'all'
      ? claimRequests
      : claimRequests.filter((claimRequest) => claimRequest.status === activeTab)

  const tabCounts = {
    all: claimRequests.length,
    pending: claimRequests.filter((claimRequest) => claimRequest.status === 'pending').length,
    approved: claimRequests.filter((claimRequest) => claimRequest.status === 'approved').length,
    rejected: claimRequests.filter((claimRequest) => claimRequest.status === 'rejected').length,
  }

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setRejectTarget(null)
    setRejectNotes('')
    setRejectReasonPreset('')
    setError(null)
  }

  function beginReject(kind: NonNullable<RejectActionTarget>['kind'], id: string) {
    setRejectTarget({ kind, id })
    setRejectNotes('')
    setRejectReasonPreset('')
    setError(null)
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      setError(null)
      const result = await approveClaimAction(id)
      if (result?.error) setError(result.error)
    })
  }

  function handleRejectClaim(id: string) {
    if (rejectTarget?.kind !== 'claim' || rejectTarget.id !== id) {
      beginReject('claim', id)
      return
    }

    const notes = rejectNotes.trim()
    if (!notes) {
      setError('Rejection notes are required.')
      return
    }

    startTransition(async () => {
      setError(null)
      const result = await rejectClaimAction(id, notes)
      if (result?.error) setError(result.error)
      else {
        setRejectTarget(null)
        setRejectNotes('')
        setRejectReasonPreset('')
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

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
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
              <TableHead>申請者</TableHead>
              <TableHead>證明</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((claimRequest) => (
              <Fragment key={claimRequest.id}>
                <TableRow
                  aria-expanded={expandedId === claimRequest.id}
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => handleRowClick(claimRequest.id)}
                >
                  <TableCell className="font-medium">
                    {claimRequest.brandName ?? 'Unknown brand'}
                  </TableCell>
                  <TableCell>
                    <span>{claimRequest.requesterEmail ?? 'Unknown'}</span>
                    {claimRequest.existingOwnedBrand ? (
                      <span className="mt-1 block type-label text-destructive">
                        {adminClaimT('ownerAlreadyManagesShort')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{claimRequest.proofEvidence.length}</TableCell>
                  <TableCell>{formatDate(claimRequest.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={claimRequest.status} />
                  </TableCell>
                </TableRow>

                {expandedId === claimRequest.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-background p-6 whitespace-normal">
                      <div className="space-y-4">
                        {claimRequest.existingOwnedBrand ? (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                            <p className="type-subsection-title text-destructive">
                              {adminClaimT('ownerAlreadyManagesTitle')}
                            </p>
                            <p className="mt-1 type-card-description">
                              {adminClaimT('ownerAlreadyManagesBody', {
                                brandName: claimRequest.existingOwnedBrand.brandName,
                              })}
                            </p>
                            <a
                              href={`/brands/${claimRequest.existingOwnedBrand.brandSlug}`}
                              className="mt-2 inline-block type-link underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {claimRequest.existingOwnedBrand.brandName}
                            </a>
                          </div>
                        ) : null}
                        <div className="space-y-3">
                          <p className="type-metadata">
                            Proof evidence
                          </p>
                          {claimRequest.proofEvidence.length > 0 ? (
                            <div className="space-y-3">
                              {claimRequest.proofEvidence.map((proof, index) => (
                                <div
                                  key={`${proof.type}-${proof.url ?? proof.imageKey ?? index}`}
                                  className="rounded-lg border border-border bg-card p-4"
                                >
                                  <div className="space-y-3">
                                    <p className="type-body-emphasis">
                                      {proofTypesT(`${PROOF_TYPE_I18N_KEYS[proof.type]}.label`)}
                                    </p>
                                    {proof.type === 'domain_email' && (
                                      <span
                                        className={proof.verified
                                          ? 'inline-flex rounded-full bg-verified-green-bg px-2 py-0.5 type-caption text-verified-green'
                                          : 'inline-flex rounded-full bg-muted px-2 py-0.5 type-caption'
                                        }
                                      >
                                        {proof.verified
                                          ? adminClaimT('domainEmailVerified')
                                          : adminClaimT('domainEmailPending')}
                                      </span>
                                    )}
                                    {proof.url && isClickableProofUrl(proof.url) && (
                                      <a
                                        href={proof.url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="inline-block break-all text-sm text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        {proof.url}
                                      </a>
                                    )}
                                    {proof.url && !isClickableProofUrl(proof.url) && (
                                      <p className="break-all type-card-description">
                                        {proof.url}
                                      </p>
                                    )}
                                    {proof.signedUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element -- Private signed proof URLs are short-lived review thumbnails.
                                      <img
                                        src={proof.signedUrl}
                                        alt={proofTypesT(`${PROOF_TYPE_I18N_KEYS[proof.type]}.label`)}
                                        className="h-20 w-20 rounded-md border border-border object-cover"
                                      />
                                    )}
                                    {proof.note && (
                                      <p className="type-card-description">
                                        {proof.note}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="type-card-description">
                              No proof evidence provided.
                            </p>
                          )}
                        </div>

                        {claimRequest.mitSmileCert && (
                          <div>
                            <p className="type-metadata">
                              MIT Smile cert
                            </p>
                            <p className="mt-1 text-sm">{claimRequest.mitSmileCert}</p>
                          </div>
                        )}

                        {claimRequest.reviewerNotes && (
                          <div>
                            <p className="type-metadata">
                              Reviewer notes
                            </p>
                            <p className="mt-1 text-sm">{claimRequest.reviewerNotes}</p>
                          </div>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}

                        {claimRequest.status === 'pending' && (
                          <div className="flex flex-col items-start gap-3 sm:flex-row">
                            <Button
                              onClick={(event) => {
                                event.stopPropagation()
                                handleApprove(claimRequest.id)
                              }}
                              disabled={isPending || Boolean(claimRequest.existingOwnedBrand)}
                            >
                              Approve
                            </Button>

                            <div className="w-full max-w-xl">
                              {rejectTarget?.kind === 'claim' &&
                                rejectTarget.id === claimRequest.id && (
                                  <div className="mb-2 space-y-2">
                                    <Select
                                      value={rejectReasonPreset}
                                      onValueChange={(value) => {
                                        if (!value) return
                                        setRejectNotes(adminClaimT(`rejectReasons.${value}`))
                                        setRejectReasonPreset('')
                                      }}
                                    >
                                      <SelectTrigger
                                        className="w-full"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <SelectValue placeholder={adminClaimT('rejectReasons.placeholder')} />
                                      </SelectTrigger>
                                      <SelectContent align="start">
                                        <SelectItem value="" disabled>
                                          {adminClaimT('rejectReasons.placeholder')}
                                        </SelectItem>
                                        {REJECT_REASON_KEYS.map((reasonKey) => (
                                          <SelectItem key={reasonKey} value={reasonKey}>
                                            {adminClaimT(`rejectReasons.${reasonKey}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Textarea
                                      autoFocus
                                      placeholder="Why are you rejecting this claim?"
                                      value={rejectNotes}
                                      onChange={(event) => setRejectNotes(event.target.value)}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </div>
                                )}
                              <Button
                                variant={
                                  rejectTarget?.kind === 'claim' &&
                                  rejectTarget.id === claimRequest.id
                                    ? 'destructive'
                                    : 'secondary'
                                }
                                size="large"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleRejectClaim(claimRequest.id)
                                }}
                                disabled={isPending}
                              >
                                {rejectTarget?.kind === 'claim' &&
                                rejectTarget.id === claimRequest.id
                                  ? 'Confirm reject'
                                  : 'Reject'}
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
                  找不到認領申請。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
