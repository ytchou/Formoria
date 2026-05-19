'use client'

import { Fragment, useState, useTransition } from 'react'
import type { BrandSubmission, SubmissionStatus } from '@/lib/types'
import { StatusBadge } from './status-badge'
import { approveSubmissionAction, rejectSubmissionAction } from '@/app/admin/actions'
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

export function SubmissionsList({
  submissions,
}: {
  submissions: BrandSubmission[]
}) {
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
      const result = await approveSubmissionAction(id)
      if (result?.error) setError(result.error)
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

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Submitter</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
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
                    {submission.brandName}
                  </TableCell>
                  <TableCell>{submission.submitterEmail}</TableCell>
                  <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={submission.status} />
                  </TableCell>
                </TableRow>

                {expandedId === submission.id && (
                  <TableRow key={`${submission.id}-expanded`}>
                    <TableCell colSpan={4} className="bg-[#FAF7F4] p-6">
                      <div className="space-y-4">
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

                        {submission.suggestedTags.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-[#7C7570]">
                              Suggested Tags
                            </p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {submission.suggestedTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex rounded-full bg-[#F5F4F1] px-2.5 py-0.5 text-xs font-medium text-[#7C7570]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {Object.keys(submission.socialLinks).length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-[#7C7570]">
                              Social Links
                            </p>
                            <div className="mt-1 space-y-1 text-sm">
                              {Object.entries(submission.socialLinks).map(
                                ([platform, value]) =>
                                  value && (
                                    <p key={platform}>
                                      <span className="capitalize">
                                        {platform}:
                                      </span>{' '}
                                      {value}
                                    </p>
                                  )
                              )}
                            </div>
                          </div>
                        )}

                        {error && (
                          <p className="text-sm text-[#D94F3D]">{error}</p>
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
                              Approve
                            </Button>
                            <div className="flex-1">
                              {rejectingId === submission.id && (
                                <Textarea
                                  placeholder="Rejection notes (optional)"
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
                                  ? 'Confirm Reject'
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
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-[#7C7570]"
                >
                  No submissions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
