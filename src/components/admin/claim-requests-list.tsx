'use client'

import { Fragment, useState, useTransition } from 'react'
import {
  approveClaimAction,
  rejectClaimAction,
  rejectMitAction,
  verifyMitAction,
} from '@/app/admin/actions'
import { StatusBadge } from '@/components/admin/status-badge'
import { Button } from '@/components/ui/button'
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
import type { ClaimRequest } from '@/lib/services/claim-requests'

type TabValue = 'all' | ClaimRequest['status']
type RejectActionTarget =
  | { kind: 'claim'; id: string }
  | { kind: 'mit'; id: string }
  | null

const PROOF_TYPE_LABELS: Record<ClaimRequest['proofType'], string> = {
  domain_email: 'Domain email',
  social_post: 'Social post',
  business_registration: 'Business registration',
}

function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function ClaimRequestsList({
  claimRequests,
}: {
  claimRequests: ClaimRequest[]
}) {
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<RejectActionTarget>(null)
  const [rejectNotes, setRejectNotes] = useState('')
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
    setError(null)
  }

  function beginReject(kind: NonNullable<RejectActionTarget>['kind'], id: string) {
    setRejectTarget({ kind, id })
    setRejectNotes('')
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
      }
    })
  }

  function handleVerifyMit(brandId: string, cert: string) {
    startTransition(async () => {
      setError(null)
      const result = await verifyMitAction(brandId, cert)
      if (result?.error) setError(result.error)
    })
  }

  function handleRejectMit(brandId: string) {
    if (rejectTarget?.kind !== 'mit' || rejectTarget.id !== brandId) {
      beginReject('mit', brandId)
      return
    }

    const notes = rejectNotes.trim()
    if (!notes) {
      setError('Rejection notes are required.')
      return
    }

    startTransition(async () => {
      setError(null)
      const result = await rejectMitAction(brandId, notes)
      if (result?.error) setError(result.error)
      else {
        setRejectTarget(null)
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

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Review ownership claims and supporting proof before granting brand access.
      </p>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
      >
        <TabsList>
          <TabsTrigger value="all">All ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="pending">
            Pending ({tabCounts.pending})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({tabCounts.approved})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({tabCounts.rejected})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Requester email</TableHead>
              <TableHead>Proof type</TableHead>
              <TableHead>Proof URL</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((claimRequest) => (
              <Fragment key={claimRequest.id}>
                <TableRow
                  aria-expanded={expandedId === claimRequest.id}
                  className="cursor-pointer"
                  onClick={() => handleRowClick(claimRequest.id)}
                >
                  <TableCell className="font-medium">
                    {claimRequest.brandName ?? 'Unknown brand'}
                  </TableCell>
                  <TableCell>{claimRequest.requesterEmail ?? 'Unknown'}</TableCell>
                  <TableCell>
                    {PROOF_TYPE_LABELS[claimRequest.proofType]}
                  </TableCell>
                  <TableCell>
                    {claimRequest.proofUrl ? (
                      isSafeHttpUrl(claimRequest.proofUrl) ? (
                      <a
                        href={claimRequest.proofUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        View proof
                      </a>
                      ) : (
                        <span className="underline underline-offset-2">
                          {claimRequest.proofUrl}
                        </span>
                      )
                    ) : (
                      'None'
                    )}
                  </TableCell>
                  <TableCell>{formatDate(claimRequest.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={claimRequest.status} />
                  </TableCell>
                </TableRow>

                {expandedId === claimRequest.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 p-6 whitespace-normal">
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Proof URL
                          </p>
                          {claimRequest.proofUrl ? (
                            isSafeHttpUrl(claimRequest.proofUrl) ? (
                              <a
                                href={claimRequest.proofUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="mt-1 inline-block break-all text-sm underline underline-offset-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {claimRequest.proofUrl}
                              </a>
                            ) : (
                              <span className="mt-1 inline-block break-all text-sm underline underline-offset-2">
                                {claimRequest.proofUrl}
                              </span>
                            )
                          ) : (
                            <p className="mt-1 text-sm">No proof URL provided.</p>
                          )}
                        </div>

                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Proof notes
                          </p>
                          <p className="mt-1 text-sm">
                            {claimRequest.proofNotes ?? 'No proof notes provided.'}
                          </p>
                        </div>

                        {claimRequest.mitSmileCert && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              MIT Smile cert
                            </p>
                            <p className="mt-1 text-sm">{claimRequest.mitSmileCert}</p>
                          </div>
                        )}

                        {claimRequest.reviewerNotes && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Reviewer notes
                            </p>
                            <p className="mt-1 text-sm">{claimRequest.reviewerNotes}</p>
                          </div>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}

                        {claimRequest.status === 'pending' && (
                          <div className="flex flex-col items-start gap-3 sm:flex-row">
                            <Button
                              size="lg"
                              className="min-h-12 px-4"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleApprove(claimRequest.id)
                              }}
                              disabled={isPending}
                            >
                              Approve
                            </Button>

                            <div className="w-full max-w-xl">
                              {rejectTarget?.kind === 'claim' &&
                                rejectTarget.id === claimRequest.id && (
                                <Textarea
                                  autoFocus
                                  placeholder="Why are you rejecting this claim?"
                                  value={rejectNotes}
                                  onChange={(event) => setRejectNotes(event.target.value)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="mb-2"
                                />
                                )}
                              <Button
                                variant={
                                  rejectTarget?.kind === 'claim' &&
                                  rejectTarget.id === claimRequest.id
                                    ? 'destructive'
                                    : 'outline'
                                }
                                size="lg"
                                className="min-h-12 px-4"
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

                        {claimRequest.mitSmileCert && (
                          <div className="space-y-3 border-t pt-4">
                            <p className="text-sm font-medium text-muted-foreground">
                              MIT verification
                            </p>
                            <div className="flex flex-col items-start gap-3 sm:flex-row">
                              <Button
                                size="lg"
                                className="min-h-12 px-4"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleVerifyMit(
                                    claimRequest.brandId,
                                    claimRequest.mitSmileCert as string
                                  )
                                }}
                                disabled={isPending}
                              >
                                Verify MIT
                              </Button>

                              <div className="w-full max-w-xl">
                                {rejectTarget?.kind === 'mit' &&
                                  rejectTarget.id === claimRequest.brandId && (
                                    <Textarea
                                      autoFocus
                                      placeholder="Why are you rejecting this MIT verification?"
                                      value={rejectNotes}
                                      onChange={(event) => setRejectNotes(event.target.value)}
                                      onClick={(event) => event.stopPropagation()}
                                      className="mb-2"
                                    />
                                  )}
                                <Button
                                  variant={
                                    rejectTarget?.kind === 'mit' &&
                                    rejectTarget.id === claimRequest.brandId
                                      ? 'destructive'
                                      : 'outline'
                                  }
                                  size="lg"
                                  className="min-h-12 px-4"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleRejectMit(claimRequest.brandId)
                                  }}
                                  disabled={isPending}
                                >
                                  {rejectTarget?.kind === 'mit' &&
                                  rejectTarget.id === claimRequest.brandId
                                    ? 'Confirm reject MIT'
                                    : 'Reject MIT'}
                                </Button>
                              </div>
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
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No claim requests found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
