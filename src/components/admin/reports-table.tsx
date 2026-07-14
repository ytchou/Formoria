'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import { reviewReportAction } from '@/app/admin/actions'
import type { BrandReport, ReportReason } from '@/lib/services/reports'
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

interface ReportsTableProps {
  reports: BrandReport[]
}

const REASON_LABELS: Record<ReportReason, string> = {
  not_mit: 'Not Made in Taiwan',
  incorrect_info: 'Incorrect information',
  broken_link: 'Broken link',
  inappropriate: 'Inappropriate content',
  removal_request: 'Removal request',
}

export function ReportsTable({ reports }: ReportsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  function handleReview(id: string, decision: 'reviewed' | 'dismissed') {
    startTransition(async () => {
      await reviewReportAction(id, decision)
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

                        <div className="flex items-start gap-3">
                          <Button
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
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReview(r.id, 'dismissed')
                            }}
                            disabled={isPending}
                          >
                            Dismiss
                          </Button>
                        </div>
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
