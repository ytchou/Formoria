'use client'

import { Fragment, useState, useTransition } from 'react'
import type { FeedbackItem, FeedbackStatus } from '@/lib/services/feedback'
import { reviewFeedbackAction, syncSentryFeedbackAction } from '@/app/admin/actions'
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

type Tab = 'all' | FeedbackStatus
type SourceFilter = 'all' | 'sentry' | 'tally'

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Open',
  reviewed: 'Reviewed',
  closed: 'Closed',
}

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All',
  sentry: 'Sentry',
  tally: 'Tally',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString()
}

function getTitlePreview(item: FeedbackItem) {
  return item.title ?? item.body?.slice(0, 60) ?? '—'
}

function getSourceBadgeClass(source: FeedbackItem['source']) {
  return source === 'sentry'
    ? 'bg-purple-100 text-purple-700'
    : 'bg-blue-100 text-blue-700'
}

function getStatusBadgeClass(status: FeedbackStatus) {
  if (status === 'open') return 'bg-yellow-100 text-yellow-700'
  if (status === 'reviewed') return 'bg-green-100 text-green-700'
  return 'bg-[#F5F4F1] text-[#7C7570]'
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = items.filter((item) => {
    const statusMatches = activeTab === 'all' || item.status === activeTab
    const sourceMatches = sourceFilter === 'all' || item.source === sourceFilter

    return statusMatches && sourceMatches
  })

  const tabCounts = {
    all: items.length,
    open: items.filter((item) => item.status === 'open').length,
    reviewed: items.filter((item) => item.status === 'reviewed').length,
    closed: items.filter((item) => item.status === 'closed').length,
  }

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setActionError(null)
  }

  function handleStatusChange(id: string, status: FeedbackStatus) {
    setActionError(null)
    startTransition(async () => {
      const result = await reviewFeedbackAction(id, status)
      if (result?.error) setActionError(result.error)
    })
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMessage(null)

    try {
      const result = await syncSentryFeedbackAction()
      if ('error' in result) {
        setSyncMessage(result.error)
      } else {
        setSyncMessage(`Synced ${result.synced} feedback item(s).`)
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'sentry', 'tally'] as SourceFilter[]).map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={sourceFilter === source}
              onClick={() => setSourceFilter(source)}
              className={
                sourceFilter === source
                  ? 'rounded-full border border-[#2F5D50] bg-[#2F5D50] px-3 py-1 text-sm font-medium text-white'
                  : 'rounded-full border border-[#E5E0D8] bg-white px-3 py-1 text-sm font-medium text-[#7C7570] hover:border-[#2F5D50]'
              }
            >
              {SOURCE_LABELS[source]}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <Button
            onClick={handleSync}
            disabled={syncing}
            className="bg-[#2F5D50] text-white hover:bg-[#1F3F36]"
          >
            {syncing ? 'Syncing...' : 'Sync Sentry'}
          </Button>
          {syncMessage && (
            <p className="text-sm text-[#7C7570]">{syncMessage}</p>
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as Tab)}
      >
        <TabsList>
          <TabsTrigger value="all">All ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="open">Open ({tabCounts.open})</TabsTrigger>
          <TabsTrigger value="reviewed">
            Reviewed ({tabCounts.reviewed})
          </TabsTrigger>
          <TabsTrigger value="closed">Closed ({tabCounts.closed})</TabsTrigger>
        </TabsList>
      </Tabs>

      {actionError && (
        <p className="mt-4 text-sm text-[#D94F3D]">{actionError}</p>
      )}

      <div className="mt-4 rounded-lg border border-[#E5E0D8] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Title/Preview</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <Fragment key={item.id}>
                <TableRow
                  className="cursor-pointer hover:bg-[#F5F4F1]"
                  onClick={() => handleRowClick(item.id)}
                >
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getSourceBadgeClass(item.source)}`}
                    >
                      {SOURCE_LABELS[item.source]}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{item.type}</TableCell>
                  <TableCell className="max-w-xs truncate font-medium text-[#1C1C1C]">
                    {getTitlePreview(item)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(item.status)}`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </TableCell>
                  <TableCell>{formatDate(item.createdAt)}</TableCell>
                  <TableCell
                    onClick={(event) => event.stopPropagation()}
                    className="space-x-2"
                  >
                    {item.status !== 'reviewed' && (
                      <Button
                        size="sm"
                        onClick={() => handleStatusChange(item.id, 'reviewed')}
                        disabled={isPending}
                        className="bg-[#2F5D50] text-white hover:bg-[#1F3F36]"
                      >
                        Mark Reviewed
                      </Button>
                    )}
                    {item.status !== 'closed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatusChange(item.id, 'closed')}
                        disabled={isPending}
                      >
                        Close
                      </Button>
                    )}
                  </TableCell>
                </TableRow>

                {expandedId === item.id && (
                  <TableRow className="bg-[#FAF7F4]">
                    <TableCell colSpan={6} className="p-6">
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            Body
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-[#1C1C1C]">
                            {item.body ?? '—'}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            URL
                          </p>
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block break-all text-sm text-[#2F5D50] underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {item.url}
                            </a>
                          ) : (
                            <p className="mt-1 text-sm text-[#1C1C1C]">—</p>
                          )}
                        </div>

                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            User Email
                          </p>
                          <p className="mt-1 text-sm text-[#1C1C1C]">
                            {item.userEmail ?? '—'}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            Sentry Event ID
                          </p>
                          <p className="mt-1 font-mono text-sm text-[#1C1C1C]">
                            {item.sentryEventId ?? '—'}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-[#7C7570]">
                            Reviewed At
                          </p>
                          <p className="mt-1 text-sm text-[#1C1C1C]">
                            {item.reviewedAt ? formatDate(item.reviewedAt) : '—'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-[#7C7570]"
                >
                  No feedback items.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
