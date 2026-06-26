'use client'

import { Popover } from '@base-ui/react/popover'
import { PHASE_LABELS } from '@/lib/constants/enrich-phases'
import type { PhaseResult, PhaseStatus } from '@/lib/types/curation'
import { Badge } from '@/components/ui/badge'

const STATUS_CONFIG: Record<PhaseStatus, { label: string; className: string }> = {
  succeeded: { label: '成功', className: 'bg-[#EAF3E8] text-[#2D5A27]' },
  skipped: { label: '略過', className: 'bg-[#F5F4F1] text-[#7C7570]' },
  failed: { label: '失敗', className: 'bg-[#FDF3EC] text-[#D94F3D]' },
}

const FIELD_LABELS: Record<string, string> = {
  description: '描述',
  brand_highlights: '品牌亮點',
  social_instagram: 'IG',
  social_threads: 'Threads',
  social_facebook: 'FB',
  purchase_website: '購買連結',
  official_website: '官網',
  hero_image_url: '主圖',
  product_photos: '產品照片',
  product_type: '產品類型',
  tag_slugs: '標籤',
  slug: '網址代稱',
  brand_name_en: '英文名',
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return '< 1ms'

  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatChangedFields(fields: string[]): string {
  if (fields.length === 0) return '-'
  return fields.map((field) => FIELD_LABELS[field] ?? field).join(', ')
}

function PhaseBadge({ phaseResult }: { phaseResult: PhaseResult }) {
  const phaseName = PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase
  const status = STATUS_CONFIG[phaseResult.status]

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Badge
            className={`${status.className} cursor-pointer text-[11px]`}
          />
        }
      >
        {phaseName}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className="z-50 w-64 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div className="space-y-2">
              <div className="font-medium text-foreground">{phaseName}</div>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">狀態</dt>
                  <dd>{status.label}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">耗時</dt>
                  <dd>{formatDuration(phaseResult.durationMs)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">變更欄位</dt>
                  <dd>{formatChangedFields(phaseResult.changedFields)}</dd>
                </div>
              </dl>
              {phaseResult.error && (
                <div className="text-xs text-[#D94F3D]">{phaseResult.error}</div>
              )}
              {phaseResult.detail && (
                <div className="text-xs text-muted-foreground">{phaseResult.detail}</div>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function PhaseBadges({ phaseResults }: { phaseResults?: PhaseResult[] }) {
  if (!phaseResults || phaseResults.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {phaseResults.map((phaseResult) => (
        <PhaseBadge
          key={`${phaseResult.phase}-${phaseResult.status}`}
          phaseResult={phaseResult}
        />
      ))}
    </div>
  )
}
