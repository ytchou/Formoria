'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { bulkUpdateFlagsAction, reviewFlagAction, revertFlagAction } from '@/app/admin/actions'
import type { ModerationFlag } from '@/lib/services/moderation'

interface FlaggedTableProps {
  flags: ModerationFlag[]
}

export function FlaggedTable({ flags }: FlaggedTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allSelected = flags.length > 0 && selected.size === flags.length
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(flags.map((f) => f.id)))
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
      const result = await bulkUpdateFlagsAction(Array.from(selected), decision)
      setSelected(new Set())
      if (result.errors.length > 0) {
        setBulkResult(`Updated ${result.updated}, ${result.errors.length} failed`)
      } else {
        setBulkResult(`Updated ${result.updated} flag(s)`)
      }
    })
  }

  return (
    <div>
      {someSelected && (
        <div className="mb-4 flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2 text-sm">
          <span className="text-muted-foreground">{selected.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulk('reviewed')}
            disabled={isPending}
          >
            Review selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleBulk('dismissed')}
            disabled={isPending}
          >
            Dismiss selected
          </Button>
          {bulkResult && (
            <span className="ml-2 text-xs text-muted-foreground">{bulkResult}</span>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs font-medium uppercase text-muted-foreground">
              <th className="pb-3 pr-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="pb-3 pr-4">Brand</th>
              <th className="pb-3 pr-4">Field</th>
              <th className="pb-3 pr-4">Content</th>
              <th className="pb-3 pr-4">Reason</th>
              <th className="pb-3 pr-4">Date</th>
              <th className="pb-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-b">
                <td className="py-3 pr-2">
                  <input
                    type="checkbox"
                    aria-label={`Select flag for ${flag.brandName ?? 'unknown'}`}
                    checked={selected.has(flag.id)}
                    onChange={() => toggleOne(flag.id)}
                    className="cursor-pointer"
                  />
                </td>
                <td className="py-3 pr-4 font-medium">
                  {flag.brandName ?? 'Unknown'}
                </td>
                <td className="py-3 pr-4">{flag.fieldName}</td>
                <td className="max-w-xs py-3 pr-4">
                  {flag.previousContent !== null ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="mb-1 block font-medium text-muted-foreground">Before</span>
                        <span className="text-muted-foreground">{flag.previousContent}</span>
                      </div>
                      <div>
                        <span className="mb-1 block font-medium">After</span>
                        <span>{flag.flaggedContent}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="truncate text-muted-foreground">{flag.flaggedContent}</span>
                  )}
                </td>
                <td className="py-3 pr-4">{flag.flagReason}</td>
                <td className="py-3 pr-4 text-muted-foreground">
                  {new Date(flag.createdAt).toLocaleDateString()}
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap gap-2">
                    <form
                      action={async () => {
                        await reviewFlagAction(flag.id, 'reviewed')
                      }}
                    >
                      <Button size="sm" variant="outline">
                        Review
                      </Button>
                    </form>
                    <form
                      action={async () => {
                        await reviewFlagAction(flag.id, 'dismissed')
                      }}
                    >
                      <Button size="sm" variant="ghost">
                        Dismiss
                      </Button>
                    </form>
                    {flag.previousContent !== null && (
                      <form
                        action={async () => {
                          await revertFlagAction(flag.id)
                        }}
                      >
                        <Button size="sm" variant="destructive">
                          Revert
                        </Button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
