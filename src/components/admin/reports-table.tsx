'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import { reviewReportAction, revokeOwnershipAction } from '@/app/admin/actions'
import type { BrandReport, ReportReason } from '@/lib/services/reports'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

interface ReportsTableProps {
  reports: BrandReport[]
}

const REASON_LABELS: Record<ReportReason, string> = {
  not_mit: 'Not Made in Taiwan',
  incorrect_info: 'Incorrect information',
  broken_link: 'Broken link',
  inappropriate: 'Inappropriate content',
  ownership_dispute: 'Ownership dispute',
  removal_request: 'Removal request',
}

export function ReportsTable({ reports }: ReportsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setRevokeReason('')
    setIsRevokeDialogOpen(false)
  }

  function handleReview(id: string, decision: 'reviewed' | 'dismissed') {
    startTransition(async () => {
      await reviewReportAction(id, decision)
    })
  }

  function handleRevoke(brandId: string) {
    const reason = revokeReason.trim()
    if (!reason) return

    startTransition(async () => {
      const result = await revokeOwnershipAction(brandId, reason)
      if (!result?.error) {
        setIsRevokeDialogOpen(false)
        setRevokeReason('')
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
    <div className={surfaceCardStyles({ className: 'mt-4 overflow-hidden', padding: 'none' })}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                No pending reports.
              </TableCell>
            </TableRow>
          ) : (
            reports.map((r) => (
              <Fragment key={r.id}>
                <TableRow
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => handleRowClick(r.id)}
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/brands/${r.brandSlug}`}
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.brandName}
                    </Link>
                  </TableCell>
                  <TableCell>{REASON_LABELS[r.reason]}</TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-background px-2 py-0.5 type-label text-cta border border-cta">
                      Pending
                    </span>
                  </TableCell>
                </TableRow>

                {expandedId === r.id && (
                  <TableRow>
                    <TableCell colSpan={4} className="bg-background p-6">
                      <div className="space-y-4">
                        {r.notes && (
                          <div>
                            <p className="type-metadata">
                              Additional notes
                            </p>
                            <p className="mt-1 text-sm">
                              {r.notes}
                            </p>
                          </div>
                        )}

                        {(r.reason === 'ownership_dispute' || r.reason === 'removal_request') && (
                          <dl>
                            <div>
                              <dt className="type-field-label">Reporter email</dt>
                              <dd className="mt-1 type-field-value">
                                {r.reporterEmail ?? 'Unavailable'}
                              </dd>
                            </div>
                          </dl>
                        )}

                        <div className="flex items-start gap-3">
                          <Button
                            className="min-h-12"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReview(r.id, 'reviewed')
                            }}
                            disabled={isPending}
                          >
                            Mark reviewed
                          </Button>
                          <Button
                            variant="destructive"
                            className="min-h-12"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReview(r.id, 'dismissed')
                            }}
                            disabled={isPending}
                          >
                            Dismiss
                          </Button>
                        </div>

                        {r.reason === 'ownership_dispute' && r.brandHasOwner && (
                          <>
                            <Separator />
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <Label htmlFor={`revoke-reason-${r.id}`}>
                                  Revocation reason
                                </Label>
                                <Textarea
                                  id={`revoke-reason-${r.id}`}
                                  value={revokeReason}
                                  onChange={(e) => setRevokeReason(e.target.value)}
                                  required
                                />
                              </div>
                              <Button
                                variant="destructive"
                                className="min-h-12"
                                disabled={!revokeReason.trim() || isPending}
                                onClick={() => setIsRevokeDialogOpen(true)}
                              >
                                Revoke ownership
                              </Button>
                            </div>

                            <AlertDialog
                              open={isRevokeDialogOpen}
                              onOpenChange={setIsRevokeDialogOpen}
                            >
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Revoke ownership?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This removes the current owner from {r.brandName}.
                                    The owner will be notified by email.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="min-h-12">
                                    Cancel
                                  </AlertDialogCancel>
                                  <Button
                                    variant="destructive"
                                    className="min-h-12"
                                    disabled={isPending}
                                    onClick={() => handleRevoke(r.brandId)}
                                  >
                                    {isPending ? 'Revoking…' : 'Confirm revoke'}
                                  </Button>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
