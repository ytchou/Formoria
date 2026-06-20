'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'
import { submitReportAction, type ReportState } from '@/app/[locale]/brands/[slug]/actions'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ReportDialogProps {
  brandId: string
  brandSlug: string
}

export function ReportDialog({ brandId, brandSlug }: ReportDialogProps) {
  const t = useTranslations('brandDetail.report')
  const [state, action, pending] = useActionState<ReportState, FormData>(submitReportAction, {})
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set())

  const alreadyReported =
    typeof window !== 'undefined' && !!localStorage.getItem(`report:${brandSlug}`)

  if (state.success && typeof window !== 'undefined') {
    localStorage.setItem(`report:${brandSlug}`, '1')
  }

  const reasons = [
    { value: 'not_mit', label: t('reasonNotMit') },
    { value: 'incorrect_info', label: t('reasonIncorrectInfo') },
    { value: 'broken_link', label: t('reasonBrokenLink') },
    { value: 'inappropriate', label: t('reasonInappropriate') },
  ]

  return (
    <Dialog>
      <DialogTrigger
        className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
      >
        <Flag className="size-4" />
        {t('trigger')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {state.success ? (
          <>
            <p className="py-4 text-sm text-[#7C7570]">{t('success')}</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                {t('close')}
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form action={action}>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="reason" value={[...selectedReasons].join(',')} />

            <div className="space-y-4 py-4">
              {alreadyReported && (
                <p className="rounded-lg border border-[#E5E4E1] p-3 text-sm text-[#7C7570]">
                  {t('alreadyReported')}
                </p>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('description')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {reasons.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setSelectedReasons((prev) => {
                          const next = new Set(prev)
                          if (next.has(value)) next.delete(value)
                          else next.add(value)
                          return next
                        })
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        selectedReasons.has(value)
                          ? 'border-[#1A1918] bg-[#1A1918] text-white'
                          : 'border-[#E5E4E1] text-[#1A1918] hover:border-[#C4C0BC]'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-notes" className="text-sm font-medium">
                  {t('notesPlaceholder')}
                </Label>
                <Textarea id="report-notes" name="notes" maxLength={1000} rows={3} />
              </div>

              {state.error && (
                <p className="text-sm text-[#D94F3D]">{state.error}</p>
              )}
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                {t('close')}
              </DialogClose>
              <Button
                type="submit"
                disabled={pending || alreadyReported || selectedReasons.size === 0}
              >
                {pending ? t('submitting') : t('submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
