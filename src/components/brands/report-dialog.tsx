'use client'

import { useActionState } from 'react'
import { Flag } from 'lucide-react'
import { submitReportAction, type ReportState } from '@/app/brands/[slug]/actions'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface ReportDialogProps {
  brandId: string
  brandSlug: string
}

export function ReportDialog({ brandId, brandSlug }: ReportDialogProps) {
  const [state, action, pending] = useActionState<ReportState, FormData>(submitReportAction, {})

  const alreadyReported =
    typeof window !== 'undefined' && !!localStorage.getItem(`report:${brandSlug}`)

  if (state.success && typeof window !== 'undefined') {
    localStorage.setItem(`report:${brandSlug}`, '1')
  }

  return (
    <Dialog>
      <DialogTrigger
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="檢舉"
      >
        <Flag className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>檢舉品牌</DialogTitle>
          <DialogDescription>請選擇檢舉原因</DialogDescription>
        </DialogHeader>

        {state.success ? (
          <div className="space-y-4">
            <p>感謝你的回報，我們會盡快審核。</p>
            <DialogClose>
              <Button variant="outline">關閉</Button>
            </DialogClose>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="brandId" value={brandId} />

            {alreadyReported && (
              <p className="rounded bg-muted p-2 text-sm text-muted-foreground">
                你已回報過此品牌
              </p>
            )}

            <div className="space-y-2">
              {[
                { value: 'not_mit', label: '非台灣製造' },
                { value: 'incorrect_info', label: '資訊有誤' },
                { value: 'broken_link', label: '連結失效' },
                { value: 'inappropriate', label: '不當內容' },
              ].map(({ value, label }) => (
                <Label key={value} className="flex items-center gap-2">
                  <input type="radio" name="reason" value={value} required />
                  {label}
                </Label>
              ))}
            </div>

            <Textarea name="notes" maxLength={1000} placeholder="補充說明（選填）" />

            {state.error && (
              <p className="rounded bg-destructive/10 p-2 text-sm text-destructive">
                {state.error}
              </p>
            )}

            <Button type="submit" disabled={pending || alreadyReported}>
              {pending ? '送出中...' : '送出檢舉'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
