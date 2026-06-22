'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import {
  ENRICH_PHASES,
  getCurationJobAction,
  startCurationJobAction,
  type CurationJob,
  type CurationJobParams,
  type CurationOperation,
} from '@/app/admin/operations/actions'
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
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Json } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'

interface OperationCardProps {
  operation: CurationOperation
  title: string
  description: string
  children?: ReactNode
  showValidateToggle?: boolean
  showPhasePicker?: boolean
  showStatusFilter?: boolean
}

type Scope = 'all' | 'specific'
type EnrichPhase = (typeof ENRICH_PHASES)[number]
type StatusFilter = 'all' | 'pending'

const enrichPhaseOptions: Array<{ value: EnrichPhase; label: string }> = [
  { value: 'clean', label: 'Clean names' },
  { value: 'detect', label: 'Detect non-brands' },
  { value: 'slugs', label: 'Normalize slugs' },
  { value: 'tags', label: 'Assign tags' },
  { value: 'discover', label: 'Discover URLs' },
  { value: 'links', label: 'Fill links' },
  { value: 'images', label: 'Download images' },
  { value: 'descriptions', label: 'Fill descriptions' },
]

const defaultEnrichPhases = [...ENRICH_PHASES]

type JobProgress = {
  processed: number
  total: number
  skipped: number
  failed: number
}

type JobResult = JobProgress & {
  changed: number
  error?: string
}

function isRecord(value: Json | null | undefined): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: Json | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readProgress(progress: Json | null): JobProgress {
  if (!isRecord(progress)) {
    return { processed: 0, total: 0, skipped: 0, failed: 0 }
  }

  return {
    processed: readNumber(progress.processed),
    total: readNumber(progress.total),
    skipped: readNumber(progress.skipped),
    failed: readNumber(progress.failed),
  }
}

function readResult(result: Json | null): JobResult | null {
  if (!isRecord(result)) {
    return null
  }

  return {
    processed: readNumber(result.processed),
    total: readNumber(result.total),
    skipped: readNumber(result.skipped),
    failed: readNumber(result.failed),
    changed: readNumber(result.changed),
    error: typeof result.error === 'string' ? result.error : undefined,
  }
}

function parseSlugs(value: string): string[] {
  return value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)
}

export function OperationCard({
  operation,
  title,
  description,
  children,
  showValidateToggle = false,
  showPhasePicker = false,
  showStatusFilter = false,
}: OperationCardProps) {
  const [scope, setScope] = useState<Scope>('all')
  const [slugInput, setSlugInput] = useState('')
  const [stopAfterInput, setStopAfterInput] = useState('')
  const [validateLinks, setValidateLinks] = useState(false)
  const [selectedPhases, setSelectedPhases] = useState<EnrichPhase[]>(defaultEnrichPhases)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [job, setJob] = useState<CurationJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const params = useMemo<CurationJobParams>(() => {
    const nextParams: CurationJobParams = {}
    const slugs = parseSlugs(slugInput)
    const stopAfter = Number.parseInt(stopAfterInput, 10)

    if (scope === 'specific' && slugs.length > 0) {
      nextParams.slugs = slugs
    }

    if (Number.isInteger(stopAfter) && stopAfter > 0) {
      nextParams.stopAfter = stopAfter
    }

    if (showValidateToggle) {
      nextParams.validate = validateLinks
    }

    if (showPhasePicker) {
      nextParams.phases = selectedPhases
    }

    if (showStatusFilter && statusFilter === 'pending') {
      nextParams.status = 'pending'
    }

    return nextParams
  }, [
    scope,
    selectedPhases,
    showPhasePicker,
    showStatusFilter,
    showValidateToggle,
    slugInput,
    statusFilter,
    stopAfterInput,
    validateLinks,
  ])

  const progress = readProgress(job?.progress ?? null)
  const result = readResult(job?.result ?? null)
  const progressValue = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0
  const isJobActive = job?.status === 'pending' || job?.status === 'running'
  const isActionDisabled = isPending || isJobActive

  function togglePhase(phase: EnrichPhase, checked: boolean) {
    setSelectedPhases((currentPhases) => {
      if (checked) {
        return currentPhases.includes(phase) ? currentPhases : [...currentPhases, phase]
      }

      if (currentPhases.length === 1) {
        return currentPhases
      }

      return currentPhases.filter((currentPhase) => currentPhase !== phase)
    })
  }

  useEffect(() => {
    if (!job?.id || !isJobActive) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      startTransition(async () => {
        const response = await getCurationJobAction(job.id)

        if ('error' in response) {
          setError(response.error)
          return
        }

        setJob(response.job)
      })
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [isJobActive, job?.id])

  function runOperation(dryRun: boolean) {
    setError(null)
    startTransition(async () => {
      const response = await startCurationJobAction(operation, params, dryRun)

      if ('error' in response) {
        setError(response.error)
        return
      }

      const jobResponse = await getCurationJobAction(response.jobId)

      if ('error' in jobResponse) {
        setError(jobResponse.error)
        setJob({
          id: response.jobId,
          operation,
          status: 'pending',
          params,
          dry_run: dryRun,
          progress: null,
          result: null,
          started_by: '',
          created_at: null,
          started_at: null,
          completed_at: null,
        })
        return
      }

      setJob(jobResponse.job)
    })
  }

  return (
    <Card className="border-border bg-card text-foreground shadow-sm">
      <CardHeader className="space-y-1 p-4">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>

      <CardContent className="space-y-4 p-4 pt-0">
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Scope</p>
          <div className="grid gap-2">
            <Label className="min-h-12 cursor-pointer rounded-lg border border-border px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
              <input
                type="radio"
                name={`${operation}-scope`}
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
                className="size-4 accent-primary"
              />
              <span>All brands</span>
            </Label>
            <Label className="min-h-12 cursor-pointer rounded-lg border border-border px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
              <input
                type="radio"
                name={`${operation}-scope`}
                value="specific"
                checked={scope === 'specific'}
                onChange={() => setScope('specific')}
                className="size-4 accent-primary"
              />
              <span>Specific slugs</span>
            </Label>
          </div>

          {scope === 'specific' && (
            <div className="space-y-2">
              <Label htmlFor={`${operation}-slugs`}>Comma-separated slugs</Label>
              <Input
                id={`${operation}-slugs`}
                value={slugInput}
                onChange={(event) => setSlugInput(event.target.value)}
                placeholder="brand-one, brand-two"
                className="min-h-12 focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          )}
        </div>

        {showStatusFilter && (
          <div className="space-y-2">
            <Label htmlFor={`${operation}-status`}>Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger
                id={`${operation}-status`}
                className="min-h-12 w-full focus-visible:ring-2 focus-visible:ring-primary"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">All brands</SelectItem>
                <SelectItem value="pending">Pending only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`${operation}-stop-after`}>Stop after N brands</Label>
          <Input
            id={`${operation}-stop-after`}
            type="number"
            min={1}
            inputMode="numeric"
            value={stopAfterInput}
            onChange={(event) => setStopAfterInput(event.target.value)}
            placeholder="Optional"
            className="min-h-12 focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        {showValidateToggle && (
          <Label className="min-h-12 cursor-pointer rounded-lg border border-border px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
            <input
              type="checkbox"
              checked={validateLinks}
              onChange={(event) => setValidateLinks(event.target.checked)}
              className="size-4 accent-primary"
            />
            <span>Validate links</span>
          </Label>
        )}

        {showPhasePicker && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Phases</p>
            <div className="grid gap-2">
              {enrichPhaseOptions.map((phase) => {
                const checked = selectedPhases.includes(phase.value)

                return (
                  <Label
                    key={phase.value}
                    className="min-h-12 cursor-pointer justify-between rounded-lg border border-border px-3 py-2 focus-within:ring-2 focus-within:ring-primary"
                  >
                    <span>{phase.label}</span>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value: boolean) => togglePhase(phase.value, value)}
                      aria-label={phase.label}
                    />
                  </Label>
                )
              })}
            </div>
          </div>
        )}

        {children}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {job && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">
                {job.dry_run ? 'Preview' : 'Execute'} job
              </span>
              <span className="capitalize text-muted-foreground">{job.status}</span>
            </div>
            {isJobActive && (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(progressValue, 100)}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Processing {progress.processed}/{progress.total}... ({progress.skipped} skipped,{' '}
                  {progress.failed} failed)
                </p>
              </div>
            )}
          </div>
        )}

        {job?.status === 'completed' && result && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
            <p className="font-medium text-primary">Completed successfully</p>
            <p className="mt-1 text-muted-foreground">
              {result.changed} changed, {result.skipped} skipped, {result.failed} failed,{' '}
              {result.processed}/{result.total} processed.
            </p>
          </div>
        )}

        {job?.status === 'failed' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">Job failed</p>
            {result?.error && <p className="mt-1">{result.error}</p>}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={() => runOperation(true)}
            disabled={isActionDisabled}
            className="min-h-12 bg-primary px-5 text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            {isPending ? 'Starting...' : 'Preview'}
          </Button>
          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isActionDisabled}
            className="min-h-12 bg-cta px-5 text-white hover:bg-cta/90 focus-visible:ring-2 focus-visible:ring-primary"
          >
            Execute
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This will modify brand data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setConfirmOpen(false)
                runOperation(false)
              }}
              disabled={isPending}
              className={cn(
                'min-h-12 bg-cta px-5 text-white hover:bg-cta/90',
                'focus-visible:ring-2 focus-visible:ring-primary'
              )}
            >
              Execute
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
