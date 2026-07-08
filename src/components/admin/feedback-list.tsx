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

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: '待處理',
  reviewed: '已審閱',
  closed: '已關閉',
}

const SOURCE_LABELS: Record<FeedbackItem['source'], string> = {
  sentry: 'Sentry',
  tally: 'Tally',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getTitlePreview(item: FeedbackItem) {
  return item.title ?? item.body?.slice(0, 60) ?? '—'
}

function getStatusBadgeClass(status: FeedbackStatus) {
  if (status === 'open') return 'bg-background text-cta border border-cta'
  if (status === 'reviewed') return 'bg-verified-green-bg text-verified-green'
  return 'bg-secondary text-muted-foreground'
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered =
    activeTab === 'all'
      ? items
      : items.filter((item) => item.status === activeTab)

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

    startTransition(async () => {
      try {
        const result = await syncSentryFeedbackAction()
        if ('error' in result) {
          setSyncMessage(result.error)
        } else {
          setSyncMessage(`已同步 ${result.synced} 筆回饋。`)
        }
      } finally {
        setSyncing(false)
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as Tab)}
        >
          <TabsList>
            <TabsTrigger value="all">全部 ({tabCounts.all})</TabsTrigger>
            <TabsTrigger value="open">待處理 ({tabCounts.open})</TabsTrigger>
            <TabsTrigger value="reviewed">
              已審閱 ({tabCounts.reviewed})
            </TabsTrigger>
            <TabsTrigger value="closed">已關閉 ({tabCounts.closed})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '同步中...' : '同步 Sentry'}
          </Button>
          {syncMessage && (
            <p className="type-card-description">{syncMessage}</p>
          )}
        </div>
      </div>

      {actionError && (
        <p className="mt-4 text-sm text-destructive">{actionError}</p>
      )}

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>來源</TableHead>
              <TableHead>標題</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <Fragment key={item.id}>
                <TableRow
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => handleRowClick(item.id)}
                >
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {SOURCE_LABELS[item.source]}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-medium">
                    {getTitlePreview(item)}
                  </TableCell>
                  <TableCell>{formatDate(item.createdAt)}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(item.status)}`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </TableCell>
                </TableRow>

                {expandedId === item.id && (
                  <TableRow>
                    <TableCell colSpan={4} className="bg-background p-6">
                      <div className="space-y-4">
                        {item.body && (
                          <div>
                            <p className="type-metadata">
                              內容
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm">
                              {item.body}
                            </p>
                          </div>
                        )}

                        {item.url && (
                          <div>
                            <p className="type-metadata">
                              頁面 URL
                            </p>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block break-all text-sm text-cta underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.url}
                            </a>
                          </div>
                        )}

                        {item.userEmail && (
                          <div>
                            <p className="type-metadata">
                              使用者信箱
                            </p>
                            <p className="mt-1 text-sm">{item.userEmail}</p>
                          </div>
                        )}

                        {item.sentryEventId && (
                          <div>
                            <p className="type-metadata">
                              Sentry Event ID
                            </p>
                            <p className="mt-1 font-mono text-sm">
                              {item.sentryEventId}
                            </p>
                          </div>
                        )}

                        <div className="flex items-start gap-3">
                          {item.status !== 'reviewed' && (
                            <Button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStatusChange(item.id, 'reviewed')
                              }}
                              disabled={isPending}
                              className="bg-cta hover:bg-cta/90"
                            >
                              標記已審閱
                            </Button>
                          )}
                          {item.status !== 'closed' && (
                            <Button
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStatusChange(item.id, 'closed')
                              }}
                              disabled={isPending}
                            >
                              關閉
                            </Button>
                          )}
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
                  colSpan={4}
                  className="py-8 text-center text-muted-foreground"
                >
                  找不到回饋記錄。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
