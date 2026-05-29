'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { reviewReportAction, bulkUpdateReportsAction } from '@/app/admin/actions'
import type { BrandReport, ReportReason } from '@/lib/services/reports'

interface ReportsTableProps {
  reports: BrandReport[]
}

const REASON_LABELS: Record<ReportReason, string> = {
  not_mit: '非台灣製造',
  incorrect_info: '資訊有誤',
  broken_link: '連結失效',
  inappropriate: '不當內容',
}

export function ReportsTable({ reports }: ReportsTableProps) {
  const [selected, setSelected] = useState(new Set<string>())
  const [, startTransition] = useTransition()

  if (reports.length === 0) {
    return <p className="text-muted-foreground">目前沒有待處理的檢舉。</p>
  }

  function toggleAll() {
    if (selected.size === reports.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(reports.map((r) => r.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleBulk(decision: 'reviewed' | 'dismissed') {
    startTransition(async () => {
      await bulkUpdateReportsAction(Array.from(selected), decision)
      setSelected(new Set())
    })
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleBulk('reviewed')}>
            批量審核
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleBulk('dismissed')}>
            批量忽略
          </Button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="w-10 py-2">
              <input
                type="checkbox"
                checked={selected.size === reports.length}
                onChange={toggleAll}
                aria-label="全選"
              />
            </th>
            <th className="py-2 text-left">品牌</th>
            <th className="py-2 text-left">原因</th>
            <th className="py-2 text-left">補充</th>
            <th className="py-2 text-left">日期</th>
            <th className="py-2 text-left">操作</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggleOne(r.id)}
                  aria-label={`選擇 ${r.brandName}`}
                />
              </td>
              <td className="py-2">
                <Link href={`/brands/${r.brandSlug}`} className="underline">
                  {r.brandName}
                </Link>
              </td>
              <td className="py-2">{REASON_LABELS[r.reason]}</td>
              <td className="max-w-xs truncate py-2">{r.notes ?? '—'}</td>
              <td className="py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
              <td className="py-2">
                <div className="flex gap-2">
                  <form
                    action={async () => {
                      await reviewReportAction(r.id, 'reviewed')
                    }}
                  >
                    <Button type="submit" size="sm">
                      審核
                    </Button>
                  </form>
                  <form
                    action={async () => {
                      await reviewReportAction(r.id, 'dismissed')
                    }}
                  >
                    <Button type="submit" size="sm" variant="outline">
                      忽略
                    </Button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
