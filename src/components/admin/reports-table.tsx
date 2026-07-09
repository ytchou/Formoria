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
  not_mit: '非台灣製造',
  incorrect_info: '資訊有誤',
  broken_link: '連結失效',
  inappropriate: '不當內容',
  removal_request: '要求移除',
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
            <TableHead>品牌</TableHead>
            <TableHead>原因</TableHead>
            <TableHead>日期</TableHead>
            <TableHead>狀態</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                目前沒有待處理的檢舉。
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
                    <span className="inline-flex items-center rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-cta border border-cta">
                      待處理
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
                              補充說明
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
                            審核
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReview(r.id, 'dismissed')
                            }}
                            disabled={isPending}
                          >
                            忽略
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
