'use client'

import NextLink from 'next/link'
import {
  useActionState,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { FileSearch, Upload, X } from 'lucide-react'
import {
  submitEvidenceAction,
  type EvidenceState,
} from '@/app/[locale]/brands/[slug]/actions'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/ui/typography'
import { useImageUpload } from '@/components/upload/useImageUpload'
import { usePathname } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import { MAX_NOTES_LENGTH, type OriginEvidenceStance } from '@/lib/services/origin-evidence'
import { cn } from '@/lib/utils'

interface EvidenceDialogProps {
  brandId: string
  brandSlug: string
}

export function EvidenceDialog({ brandId, brandSlug }: EvidenceDialogProps) {
  const t = useTranslations('brandDetail.evidence')
  const locale = useLocale() as 'zh-TW' | 'en'
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [state, action, pending] = useActionState<EvidenceState, FormData>(
    submitEvidenceAction,
    {},
  )
  const [stance, setStance] = useState<OriginEvidenceStance | null>(null)
  const [notesLength, setNotesLength] = useState(0)
  const [photoPath, setPhotoPath] = useState('')
  const [lastFile, setLastFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadState = useImageUpload({
    bucket: 'origin-evidence',
    path: `${user?.id ?? 'anonymous'}/${brandId}`,
    invalidTypeMessage: t('errors.invalidPhotoType'),
  })
  const uploading = uploadState.status === 'uploading'

  async function uploadPhoto(file: File) {
    setPhotoPath('')
    const result = await uploadState.upload(file)
    if (result?.key) setPhotoPath(result.key)
  }

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setLastFile(file)
    await uploadPhoto(file)
    event.target.value = ''
  }

  return (
    <Dialog>
      <DialogTrigger
        data-evidence-dialog-trigger
        className={buttonVariants({
          variant: 'ghost',
          className: 'min-h-12 w-full justify-start rounded-lg',
        })}
      >
        {t('trigger')}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-10 sm:top-4 sm:right-4"
              aria-label={t('close')}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>

        <DialogHeader className="flex-row gap-3 p-4 pr-14 sm:p-6 sm:pr-16">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileSearch className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </div>
        </DialogHeader>

        {state.success ? (
          <div className="flex min-h-0 flex-col">
            <Typography variant="cardDescription" className="flex-1 px-4 py-6 sm:px-6">
              {t('success')}
            </Typography>
            <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
              <DialogClose render={<Button variant="secondary" />}>
                {t('close')}
              </DialogClose>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex min-h-0 flex-col">
            <Typography variant="cardDescription" className="flex-1 px-4 py-6 sm:px-6">
              {t('loading')}
            </Typography>
            <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
              <DialogClose render={<Button variant="secondary" />}>
                {t('cancel')}
              </DialogClose>
            </DialogFooter>
          </div>
        ) : !user ? (
          <div className="flex min-h-0 flex-col">
            <Typography variant="cardDescription" className="flex-1 px-4 py-6 sm:px-6">
              {t('signInPrompt')}
            </Typography>
            <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
              <DialogClose render={<Button variant="secondary" />}>
                {t('cancel')}
              </DialogClose>
              <NextLink
                href={signInHref(pathname, locale)}
                className={buttonVariants({ variant: 'primary' })}
              >
                {t('signIn')}
              </NextLink>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="flex min-h-0 flex-col overflow-hidden">
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="brandSlug" value={brandSlug} />
            <input type="hidden" name="stance" value={stance ?? ''} />
            {photoPath && <input type="hidden" name="photoPaths" value={photoPath} />}

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
              <fieldset className="space-y-3">
                <legend className="type-subsection-title">{t('stanceLabel')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['supports', 'contradicts'] as const).map((value) => (
                    <Label
                      key={value}
                      className={cn(
                        'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors',
                        stance === value && 'border-primary bg-primary/10 text-primary',
                      )}
                    >
                      <Input
                        type="radio"
                        name="stanceChoice"
                        value={value}
                        checked={stance === value}
                        required
                        className="size-4 min-w-4 shrink-0 p-0 accent-primary"
                        onChange={() => setStance(value)}
                      />
                      <span>{t(`stances.${value}`)}</span>
                    </Label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="evidence-product-name">{t('productNameLabel')}</Label>
                <Input
                  id="evidence-product-name"
                  name="productName"
                  placeholder={t('productNamePlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="evidence-source-type">{t('sourceTypeLabel')}</Label>
                <NativeSelect id="evidence-source-type" name="sourceType" defaultValue="product_label">
                  <option value="product_label">{t('sourceTypes.product_label')}</option>
                  <option value="packaging">{t('sourceTypes.packaging')}</option>
                  <option value="official_site">{t('sourceTypes.official_site')}</option>
                  <option value="in_store">{t('sourceTypes.in_store')}</option>
                  <option value="other">{t('sourceTypes.other')}</option>
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="evidence-notes">{t('notesLabel')}</Label>
                  <span
                    className="type-caption tabular-nums text-muted-foreground"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {notesLength} / {MAX_NOTES_LENGTH}
                  </span>
                </div>
                <Textarea
                  id="evidence-notes"
                  name="notes"
                  maxLength={MAX_NOTES_LENGTH}
                  rows={4}
                  placeholder={t('notesPlaceholder')}
                  className="min-h-24 resize-y"
                  onChange={(event) => setNotesLength(event.currentTarget.value.length)}
                />
              </div>

              <div className="space-y-2">
                <p className="type-body-emphasis">{t('photoLabel')}</p>
                <Button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  variant="ghost"
                  className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted px-4 py-4 type-metadata transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Upload className="size-4" aria-hidden="true" />
                  <span>{uploading ? t('uploading') : t('photoHint')}</span>
                </Button>
                <Input
                  ref={inputRef}
                  id="evidence-photo"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleFileSelect}
                />
                {photoPath && (
                  <Typography variant="cardDescription" role="status">
                    {t('photoUploaded')}
                  </Typography>
                )}
                {uploadState.error && (
                  <div className="flex items-center justify-between gap-3">
                    <Typography variant="error" role="alert">
                      {uploadState.error === t('errors.invalidPhotoType')
                        ? uploadState.error
                        : t('errors.uploadFailed')}
                    </Typography>
                    {lastFile && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={uploading}
                        onClick={() => uploadPhoto(lastFile)}
                      >
                        {t('retryUpload')}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {state.error && (
                <Typography variant="error" role="alert">
                  {t(`errors.${state.error}`)}
                </Typography>
              )}
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
              <DialogClose render={<Button variant="secondary" />}>
                {t('cancel')}
              </DialogClose>
              <Button
                type="submit"
                data-ph-no-autocapture
                disabled={pending || uploading || !stance}
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
