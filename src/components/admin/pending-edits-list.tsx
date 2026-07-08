'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PendingBrandEditWithBrand } from '@/lib/types/brand'
import { approvePendingEditAction, rejectPendingEditAction } from '@/app/admin/actions'
import { EditDiffView, computeDiffFields } from './edit-diff-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type PendingBrandEditWithRisk = PendingBrandEditWithBrand & {
  moderationRiskLevel?: 'high' | 'medium' | 'clean'
}

export function PendingEditsList({ edits }: { edits: PendingBrandEditWithRisk[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectNoteId, setRejectNoteId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleToggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setRejectNoteId(null)
    setRejectNote('')
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      await approvePendingEditAction(id)
    })
  }

  function handleRejectConfirm(id: string) {
    startTransition(async () => {
      await rejectPendingEditAction(id, rejectNote)
      setRejectNoteId(null)
      setRejectNote('')
    })
  }

  return (
    <div className="rounded-lg border bg-white">
      {edits.map((edit) => {
        const isExpanded = expandedId === edit.id
        const isRejecting = rejectNoteId === edit.id

        return (
          <Fragment key={edit.id}>
            <div className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{edit.brand.name}</p>
                  {edit.moderationRiskLevel === 'high' && (
                    <Badge className="bg-destructive text-white">高風險</Badge>
                  )}
                  {edit.moderationRiskLevel === 'medium' && (
                    <Badge className="border border-mit-verified/20 bg-mit-verified-bg text-mit-verified">中風險</Badge>
                  )}
                </div>
                <p className="type-card-description">{edit.submittedBy}</p>
              </div>
              <p className="type-card-description">
                {new Date(edit.createdAt).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
              </p>
              <span className="inline-flex items-center rounded-full bg-mit-verified-bg px-2 py-0.5 type-caption text-mit-verified">
                待審核
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggle(edit.id)}
              >
                {isExpanded ? (
                  <>
                    收合 <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    展開 <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {isExpanded && (
              <div className="border-b bg-background p-6 last:border-b-0">
                <EditDiffView
                  fields={computeDiffFields(
                    edit.brand as Record<string, unknown>,
                    edit.proposedData as Record<string, unknown>
                  )}
                />

                <div className="mt-6 flex items-start gap-3">
                  <Button
                    onClick={() => handleApprove(edit.id)}
                    disabled={isPending}
                  >
                    核准
                  </Button>

                  <div className="flex flex-col gap-2">
                    {!isRejecting && (
                      <Button
                        variant="outline"
                        className="border-destructive text-destructive"
                        onClick={() => setRejectNoteId(edit.id)}
                        disabled={isPending}
                      >
                        退回
                      </Button>
                    )}

                    {isRejecting && (
                      <>
                        <Textarea
                          placeholder="退回原因"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          className="min-w-[240px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRejectNoteId(null)
                              setRejectNote('')
                            }}
                          >
                            取消
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRejectConfirm(edit.id)}
                            disabled={isPending}
                          >
                            確認退回
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Fragment>
        )
      })}

      {edits.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          目前沒有待審核的編輯申請。
        </div>
      )}
    </div>
  )
}
