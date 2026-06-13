'use client'

import { useState } from 'react'
import {
  executeBulkImportAction,
  previewBulkImportAction,
  type ImportResult,
  type PreviewRow,
} from '@/app/admin/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

type Phase = 'input' | 'preview' | 'results'

const statusLabels: Record<PreviewRow['status'], string> = {
  new: 'New',
  'potential-duplicate': 'Potential duplicate',
  error: 'Error',
}

function rowStatusBadge(row: PreviewRow) {
  if (row.status === 'error') {
    return <Badge variant="destructive">{statusLabels[row.status]}</Badge>
  }

  const className =
    row.status === 'new'
      ? 'bg-[#EAF3E8] text-[#2D5A27]'
      : 'bg-yellow-50 text-yellow-800'

  return <Badge className={className}>{statusLabels[row.status]}</Badge>
}

function resultStatusBadge(result: ImportResult) {
  if (result.status === 'error') {
    return <Badge variant="destructive">Error</Badge>
  }

  if (result.status === 'skipped') {
    return <Badge className="bg-yellow-50 text-yellow-800">Skipped</Badge>
  }

  return <Badge className="bg-[#EAF3E8] text-[#2D5A27]">Imported</Badge>
}

export function BulkImportForm() {
  const [phase, setPhase] = useState<Phase>('input')
  const [csvText, setCsvText] = useState('')
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<ImportResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const selectableIndices = previewRows
    .map((row, index) => (row.status === 'error' ? null : index))
    .filter((index): index is number => index !== null)
  const allSelectableSelected =
    selectableIndices.length > 0 &&
    selectableIndices.every((index) => selectedIndices.has(index))
  const importedCount = results.filter((result) => result.status === 'imported').length
  const skippedCount = results.filter((result) => result.status === 'skipped').length
  const errorCount = results.filter((result) => result.status === 'error').length

  async function handlePreview() {
    setLoading(true)
    setError(null)

    try {
      const response = await previewBulkImportAction(csvText)
      if (response.error) {
        setError(response.error)
        return
      }

      setPreviewRows(response.rows)
      setSelectedIndices(
        new Set(
          response.rows
            .map((row, index) => (row.status === 'new' ? index : null))
            .filter((index): index is number => index !== null)
        )
      )
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    setLoading(true)
    setError(null)

    try {
      const response = await executeBulkImportAction(
        previewRows.filter((_, index) => selectedIndices.has(index))
      )
      if (response.error) {
        setError(response.error)
        return
      }

      setResults(response.results)
      setPhase('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(index: number, checked: boolean) {
    setSelectedIndices((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(index)
      } else {
        next.delete(index)
      }
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIndices(checked ? new Set(selectableIndices) : new Set())
  }

  function resetForm() {
    setPhase('input')
    setCsvText('')
    setPreviewRows([])
    setSelectedIndices(new Set())
    setResults([])
    setError(null)
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive bg-card px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {phase === 'input' && (
        <div className="space-y-4">
          <Textarea
            rows={10}
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            placeholder="Paste CSV rows here..."
            className="min-h-48 w-full rounded-lg border border-border bg-white focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            onClick={handlePreview}
            disabled={loading}
            className="min-h-12 bg-primary px-6 text-primary-foreground"
          >
            {loading ? 'Previewing...' : 'Preview'}
          </Button>
        </div>
      )}

      {phase === 'preview' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
              {previewRows.length} rows ready for review
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">
                    <Checkbox
                      aria-label="Select all rows"
                      checked={allSelectableSelected}
                      disabled={selectableIndices.length === 0}
                      onCheckedChange={(checked: boolean) => toggleAll(checked)}
                      className="size-12 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </TableHead>
                  <TableHead>Row#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Match info</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row, index) => (
                  <TableRow key={`${row.rowIndex}-${row.name}`}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${row.name}`}
                        checked={row.status !== 'error' && selectedIndices.has(index)}
                        disabled={row.status === 'error'}
                        onCheckedChange={(checked: boolean) => toggleRow(index, checked)}
                        className="size-12 focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </TableCell>
                    <TableCell>{row.rowIndex}</TableCell>
                    <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                    <TableCell>{rowStatusBadge(row)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.status === 'error' && row.error}
                      {row.status === 'potential-duplicate' &&
                        row.match &&
                        `${row.match.brandName} (${Math.round(row.match.score * 100)}%)`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleImport}
              disabled={loading || selectedIndices.size === 0}
              className="min-h-12 bg-primary px-6 text-primary-foreground"
            >
              {loading ? 'Importing...' : 'Import selected'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPhase('input')}
              disabled={loading}
              className="min-h-12 px-6"
            >
              Back
            </Button>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">
            {importedCount} imported, {skippedCount} skipped, {errorCount} errors
          </p>
          <div className="rounded-xl border border-border bg-card p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result, index) => (
                  <TableRow key={`${result.name}-${index}`}>
                    <TableCell className="font-medium text-foreground">{result.name}</TableCell>
                    <TableCell>{resultStatusBadge(result)}</TableCell>
                    <TableCell className="text-muted-foreground">{result.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button
            type="button"
            onClick={resetForm}
            className="min-h-12 bg-primary px-6 text-primary-foreground"
          >
            Import more
          </Button>
        </div>
      )}
    </div>
  )
}
