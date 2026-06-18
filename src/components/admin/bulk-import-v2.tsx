'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import {
  executeBulkImportAction,
  previewBulkImportAction,
  type ImportExecuteResult,
  type ImportPreviewRow,
  type ImportPreviewStatus,
} from '@/app/admin/actions'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Phase = 'upload' | 'preview' | 'results'

function humanizeReason(reason: string | undefined | null): string | null {
  if (!reason) return null
  if (reason.includes('Unable to generate slug')) {
    return '無法產生網址代碼（品牌名稱可能包含特殊字元）'
  }
  try {
    const parsed = JSON.parse(reason) as unknown
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as Record<string, unknown>
      if (first.code === 'too_big') {
        const field = (first.path as string[])?.[0] ?? '欄位'
        const max = (first.maximum as number) ?? '?'
        const fieldLabel: Record<string, string> = {
          description: '說明文字',
          brandHighlights: '品牌亮點',
          productTypeNote: '產品類型備註',
          name: '品牌名稱',
        }
        return `${fieldLabel[field] ?? field} 超過 ${max} 字上限`
      }
      if (first.code === 'too_small') {
        const field = (first.path as string[])?.[0] ?? '欄位'
        const min = (first.minimum as number) ?? '?'
        const fieldLabel: Record<string, string> = {
          description: '說明文字',
          name: '品牌名稱',
        }
        return `${fieldLabel[field] ?? field} 不足 ${min} 字下限`
      }
      if (first.code === 'invalid_string' && first.validation === 'url') {
        const field = (first.path as string[])?.[0] ?? 'URL'
        return `${field} 格式不正確（需為有效網址）`
      }
    }
  } catch {
    // not JSON — return original below
  }
  return reason
}

const statusMeta: Record<ImportPreviewStatus, { label: string; className: string }> = {
  valid: { label: '可匯入', className: 'bg-[#EAF3E8] text-[#2D5A27]' },
  duplicate: { label: '可能重複', className: 'bg-[#FEF3C7] text-[#92400E]' },
  'needs-review': {
    label: '需審核',
    className: 'border border-[#C4693B] bg-[#FAF8F3] text-[#C4693B]',
  },
  error: { label: '錯誤', className: 'bg-[#FEE2E2] text-[#991B1B]' },
}

const csvColumns = [
  ['name', '品牌名稱，必填'],
  ['description', '品牌介紹，必填'],
  ['category', '既有分類欄位'],
  ['productType', '產品類型'],
  ['productTypeNote', '產品類型補充'],
  ['region', '地區標籤'],
  ['valueTags', '價值標籤，多值以 | 分隔'],
  ['logoUrl', '品牌 Logo 圖片網址'],
  ['productPhotos', '產品照片網址，多值以 | 分隔'],
  ['purchaseLinks', '購買連結 JSON 陣列'],
  ['instagram / threads / facebook / website', '社群與官網連結'],
  ['retailLocations', '實體通路 JSON 陣列'],
  ['brandHighlights', '品牌亮點'],
  ['unifiedBusinessNumber', '統一編號'],
]

function getRowWebsite(row: ImportPreviewRow): string | null {
  const data = row.validatedData as Record<string, unknown>
  const social = data?.socialLinks as Record<string, string> | undefined
  return social?.website || (data?.website as string) || null
}

const productTypeZhMap = Object.fromEntries(
  PRODUCT_TYPE_CATEGORIES.map((c) => [c.slug, c.nameZh])
)

function getRowProductTypes(row: ImportPreviewRow): string[] {
  const data = row.validatedData as Record<string, unknown>
  const types = data?.productTypes
  if (Array.isArray(types)) return types as string[]
  return []
}


function StatusBadge({ status }: { status: ImportPreviewStatus }) {
  const meta = statusMeta[status]
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}

function ResultBadge({ status }: { status: ImportExecuteResult['status'] }) {
  const className =
    status === 'created'
      ? 'bg-[#EAF3E8] text-[#2D5A27]'
      : 'bg-[#FEE2E2] text-[#991B1B]'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {status === 'created' ? '已建立' : '失敗'}
    </span>
  )
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('讀取 CSV 檔案失敗'))
    reader.readAsText(file)
  })
}

export function BulkImportV2() {
  const [phase, setPhase] = useState<Phase>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ImportPreviewRow[]>([])
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<ImportExecuteResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<ImportPreviewStatus | 'all'>('all')

  const counts = useMemo(
    () => ({
      total: rows.length,
      valid: rows.filter((row) => row.status === 'valid').length,
      duplicate: rows.filter((row) => row.status === 'duplicate').length,
      needsReview: rows.filter((row) => row.status === 'needs-review').length,
      error: rows.filter((row) => row.status === 'error').length,
    }),
    [rows],
  )
  const filteredRows = statusFilter === 'all' ? rows : rows.filter((row) => row.status === statusFilter)
  const selectableRows = rows.filter((row) => row.status === 'valid' || row.status === 'needs-review').map((row) => row.rowIndex)
  const selectedImportRows = rows.filter((row) => selectedRows.has(row.rowIndex))
  const createdCount = results.filter((result) => result.status === 'created').length
  const failedCount = results.filter((result) => result.status === 'error').length

  function handlePreview() {
    setError(null)
    if (!file) {
      setError('請先選擇 CSV 檔案')
      return
    }

    startTransition(async () => {
      try {
        const csvText = await readFileAsText(file)
        const response = await previewBulkImportAction(csvText)
        if (response.error) {
          setError(response.error)
          return
        }
        setRows(response.rows)
        setSelectedRows(
          new Set(
            response.rows
              .filter((row) => row.status === 'valid')
              .map((row) => row.rowIndex),
          ),
        )
        setPhase('preview')
      } catch (err) {
        setError(err instanceof Error ? err.message : '預覽失敗')
      }
    })
  }

  function handleImport() {
    setError(null)
    startTransition(async () => {
      const response = await executeBulkImportAction(selectedImportRows)
      if (response.error) {
        setError(response.error)
        return
      }
      setResults(response.results)
      setPhase('results')
    })
  }

  function updateRowProductType(rowIndex: number, slug: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.rowIndex !== rowIndex) return row
        return {
          ...row,
          validatedData: {
            ...row.validatedData,
            productTypes: slug ? [slug] : [],
          },
        }
      })
    )
  }

  function toggleRow(rowIndex: number, checked: boolean) {
    setSelectedRows((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(rowIndex)
      } else {
        next.delete(rowIndex)
      }
      return next
    })
  }

  function reset() {
    setPhase('upload')
    setFile(null)
    setRows([])
    setSelectedRows(new Set())
    setResults([])
    setError(null)
    setStatusFilter('all')
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-[#991B1B] bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      {phase === 'upload' && (
        <div className="space-y-5">
          <details className="rounded-lg border bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-[#F5F4F1]">
              CSV 欄位說明
            </summary>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>CSV 欄位</TableHead>
                  <TableHead>說明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvColumns.map(([column, description]) => (
                  <TableRow key={column} className="hover:bg-[#F5F4F1]">
                    <TableCell className="font-mono text-xs text-foreground">{column}</TableCell>
                    <TableCell className="text-muted-foreground">{description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>

          <div className="rounded-lg border bg-white p-4">
            <div className="space-y-3">
              <input
                type="file"
                accept=".csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
              <p className="text-sm text-muted-foreground">建議每次匯入不超過 200 筆</p>
              <Button type="button" onClick={handlePreview} disabled={isPending || !file}>
                {isPending ? '預覽中...' : '預覽'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'preview' && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white px-4 py-3 text-sm font-medium text-foreground">
            共 {counts.total} 筆：{counts.valid} 可匯入 / {counts.duplicate} 可能重複 /{' '}
            {counts.needsReview} 需審核 / {counts.error} 錯誤
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ['all', '全部', counts.total],
              ['valid', '可匯入', counts.valid],
              ['duplicate', '可能重複', counts.duplicate],
              ['needs-review', '需審核', counts.needsReview],
              ['error', '錯誤', counts.error],
            ] as const).map(([value, label, count]) => {
              const isActive = statusFilter === value
              const meta = value === 'all' ? null : statusMeta[value]
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? (meta ? meta.className + ' border-transparent' : 'border-foreground bg-foreground text-background')
                      : 'border-border bg-white text-muted-foreground hover:bg-[#F5F4F1]'
                  }`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-white/30' : 'bg-muted'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="rounded-lg border bg-white">
            <Table className="table-fixed">
              <colgroup>
                <col style={{ width: 48 }} />
                <col style={{ width: 48 }} />
                <col />
                <col style={{ width: 48 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: 280 }} />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    <input
                      type="checkbox"
                      aria-label="選取全部可匯入資料"
                      className="h-4 w-4 cursor-pointer accent-[#E06B3F]"
                      checked={selectableRows.length > 0 && selectableRows.every((id) => selectedRows.has(id))}
                      disabled={selectableRows.length === 0 || isPending}
                      onChange={(e) => {
                        setSelectedRows(e.target.checked ? new Set(selectableRows) : new Set())
                      }}
                    />
                  </TableHead>
                  <TableHead>#</TableHead>
                  <TableHead>品牌名稱</TableHead>
                  <TableHead>網址</TableHead>
                  <TableHead>產品分類</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>說明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={`${row.rowIndex}-${row.name}`} className="hover:bg-[#F5F4F1]">
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`選取 ${row.name}`}
                        className="h-4 w-4 cursor-pointer accent-[#E06B3F]"
                        checked={row.status !== 'error' && selectedRows.has(row.rowIndex)}
                        disabled={row.status === 'error' || isPending}
                        onChange={(e) => toggleRow(row.rowIndex, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>{row.rowIndex}</TableCell>
                    <TableCell className="truncate font-medium text-foreground" title={row.name}>
                      {row.name}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const url = getRowWebsite(row)
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#C4693B] hover:text-[#E06B3F]"
                            title={url}
                          >
                            ↗
                          </a>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )
                      })()}
                    </TableCell>
                    <TableCell>
                      <select
                        value={getRowProductTypes(row)[0] ?? ''}
                        onChange={(e) => updateRowProductType(row.rowIndex, e.target.value)}
                        disabled={row.status === 'error' || isPending}
                        className="w-full rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {PRODUCT_TYPE_CATEGORIES.map((cat) => (
                          <option key={cat.slug} value={cat.slug}>{cat.nameZh}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell
                      className="max-w-[350px] truncate text-muted-foreground"
                      title={humanizeReason(row.reason) ?? '資料格式正確'}
                    >
                      {humanizeReason(row.reason) ?? '資料格式正確'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={handleImport} disabled={isPending || selectedRows.size === 0}>
              {isPending ? '匯入中...' : '匯入已選'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhase('upload')} disabled={isPending}>
              返回
            </Button>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white px-4 py-3 text-sm font-medium text-foreground">
            {createdCount} 筆已建立提交，{failedCount} 筆失敗
          </div>

          <div className="rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>品牌名稱</TableHead>
                  <TableHead className="w-28">狀態</TableHead>
                  <TableHead>說明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result) => (
                  <TableRow key={`${result.rowIndex}-${result.name}`} className="hover:bg-[#F5F4F1]">
                    <TableCell>{result.rowIndex}</TableCell>
                    <TableCell className="font-medium text-foreground">{result.name}</TableCell>
                    <TableCell>
                      <ResultBadge status={result.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{result.error ?? '已送入審核佇列'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/review-queue/submissions"
              className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
            >
              前往審核佇列
            </Link>
            <Button type="button" variant="outline" onClick={reset}>
              繼續匯入
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
