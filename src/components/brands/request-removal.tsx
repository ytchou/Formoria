'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import {
  requestBrandRemovalAction,
  type RequestBrandRemovalResult,
} from '@/app/[locale]/brands/[slug]/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

type RequestRemovalProps = {
  brandId: string
}

type FeedbackState =
  | { type: 'idle' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

function getErrorMessage(result: RequestBrandRemovalResult): string | null {
  return 'error' in result ? result.error : null
}

export function RequestRemoval({ brandId }: RequestRemovalProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()

  function handleOpenChange(open: boolean) {
    setIsOpen(open)

    if (open) {
      setFeedback({ type: 'idle' })
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const message = formData.get('message')?.toString().trim() ?? ''

    setFeedback({ type: 'idle' })

    startTransition(() => {
      void (async () => {
        try {
          const result = await requestBrandRemovalAction({
            brandId,
            message: message || undefined,
          })

          const errorMessage = getErrorMessage(result)
          if (errorMessage) {
            setFeedback({ type: 'error', message: errorMessage })
            return
          }

          formRef.current?.reset()
          setIsOpen(false)
          setFeedback({
            type: 'success',
            message: '我們已收到移除請求，會交由管理員審核。 / Your removal request has been submitted for review.',
          })
        } catch {
          setFeedback({
            type: 'error',
            message: '提交失敗，請稍後再試。 / Something went wrong. Please try again.',
          })
        }
      })()
    })
  }

  return (
    <div className="space-y-2 text-left">
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger
          className="inline-flex min-h-12 items-center justify-start rounded-md px-0 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          要求移除 / Request removal
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>要求移除此品牌頁</DialogTitle>
            <DialogDescription>
              如果這個社群品牌頁不應繼續公開，我們可以交由管理員審核移除。
              If this community listing should not remain public, submit a removal request for review.
            </DialogDescription>
          </DialogHeader>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="request-removal-message" className="block text-sm font-medium text-foreground">
                補充說明
                <span className="ml-1 text-xs font-normal text-muted-foreground">Message (optional)</span>
              </label>
              <Textarea
                id="request-removal-message"
                name="message"
                maxLength={1000}
                placeholder="可補充品牌關係、原因或希望我們知道的背景資訊 / Add any context that helps review this request."
                className="min-h-28 bg-card px-3.5 py-2.5 text-sm"
              />
            </div>

            {feedback.type === 'error' && (
              <p aria-live="polite" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {feedback.message}
              </p>
            )}

            <DialogFooter className="px-0 pb-0">
              <DialogClose
                disabled={isPending}
                render={<Button type="button" variant="outline" className="h-12 w-full sm:w-auto" />}
              >
                取消 / Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={isPending}
                className="h-12 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:w-auto"
              >
                {isPending ? '提交中 / Submitting' : '確認要求移除 / Confirm removal request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {feedback.type === 'success' && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {feedback.message}
        </p>
      )}
    </div>
  )
}
