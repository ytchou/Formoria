'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PendingBrandEditWithBrand } from '@/lib/types/brand'
import { approvePendingEditAction, rejectPendingEditAction } from '@/app/admin/actions'
import { EditDiffView, computeDiffFields } from './edit-diff-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
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
    <div className={surfaceCardStyles({ padding: 'none' })}>
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
                    <Badge variant="destructive">High risk</Badge>
                  )}
                  {edit.moderationRiskLevel === 'medium' && (
                    <Badge variant="verified">Medium risk</Badge>
                  )}
                </div>
                <p className="type-card-description">{edit.submittedBy}</p>
              </div>
              <p className="type-card-description">
                {new Date(edit.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
              <Badge variant="verified">Pending review</Badge>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => handleToggle(edit.id)}
              >
                {isExpanded ? (
                  <>
                    Collapse <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Expand <ChevronDown className="ml-1 h-4 w-4" />
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
                    Approve
                  </Button>

                  <div className="flex flex-col gap-2">
                    {!isRejecting && (
                      <Button
                        variant="secondary"
                        className="border-destructive text-destructive"
                        onClick={() => setRejectNoteId(edit.id)}
                        disabled={isPending}
                      >
                        Reject
                      </Button>
                    )}

                    {isRejecting && (
                      <>
                        <Textarea
                          placeholder="Rejection reason"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          className="min-w-[240px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={() => {
                              setRejectNoteId(null)
                              setRejectNote('')
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="compact"
                            onClick={() => handleRejectConfirm(edit.id)}
                            disabled={isPending}
                          >
                            Confirm reject
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
          No pending brand edits.
        </div>
      )}
    </div>
  )
}
