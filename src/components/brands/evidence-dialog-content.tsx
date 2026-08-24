'use client'

import NextLink from 'next/link'
import {
  useActionState,
  useState,
  type ChangeEvent,
} from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  submitEvidenceAction,
  type EvidenceState,
} from '@/app/[locale]/(site)/brands/[slug]/actions'
import {
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogStatus,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Grid } from '@/components/ui/grid'
import { Input } from '@/components/ui/input'
import { UploadDropzone } from '@/components/ui/upload-dropzone'
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

interface EvidenceDialogContentProps {
  brandId: string
  brandSlug: string
}

// Split out of `evidence-dialog.tsx` so the ~250-line form (plus the upload
// hook and its Supabase client) only reaches the browser once the user primes
// the trigger. The shell keeps the trigger button, so nothing here is on the
// brand page's first-load path.
export function EvidenceDialogContent({ brandId, brandSlug }: EvidenceDialogContentProps) {
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
  const uploadState = useImageUpload({
    bucket: 'origin-evidence',
    path: `${user?.id ?? 'anonymous'}/${brandId}`,
    invalidTypeMessage: t('errors.invalidPhotoType'),
    fileTooLargeMessage: t('errors.uploadFailed'),
    uploadFailedMessage: t('errors.uploadFailed'),
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
    // The width is the shell's vocabulary, and the 85dvh cap, the two-row grid
    // and the single scroll container all belong to `DialogContent`. This body
    // used to spell every one of them here, beside its own close button.
    <DialogContent size="form">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      {/* Three states that are not a body — one sentence and the ways out of
          it — and one that is. `DialogStatus` renders its own footer, so the
          form below is the only branch that spells one out. */}
      {state.success ? (
        <DialogStatus
          message={t('success')}
          actions={
            <DialogClose render={<Button variant="secondary" />}>
              {t('close')}
            </DialogClose>
          }
        />
      ) : loading ? (
        <DialogStatus
          message={t('loading')}
          actions={
            <DialogClose render={<Button variant="secondary" />}>
              {t('cancel')}
            </DialogClose>
          }
        />
      ) : !user ? (
        <DialogStatus
          message={t('signInPrompt')}
          actions={
            <>
              <DialogClose render={<Button variant="secondary" />}>
                {t('cancel')}
              </DialogClose>
              <NextLink
                href={signInHref(pathname, locale)}
                className={buttonVariants({ variant: 'primary' })}
              >
                {t('signIn')}
              </NextLink>
            </>
          }
        />
      ) : (
        <DialogForm action={action}>
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="brandSlug" value={brandSlug} />
          <input type="hidden" name="stance" value={stance ?? ''} />
          {photoPath && <input type="hidden" name="photoPaths" value={photoPath} />}

          {/* NO `overflow-hidden` ANYWHERE ABOVE THIS. The stance radios are
              `required`, and the browser anchors its native validation bubble
              to the input — a clipped scroll container swallows it, and the
              reader is left with a submit that silently does nothing. */}
          <DialogBody className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="type-body-sm font-semibold text-ink">
                {t('stanceLabel')}
                <span aria-hidden="true" className="text-danger"> *</span>
              </legend>
              <Grid cols="pair" gap="tight">
                {(['supports', 'contradicts'] as const).map((value) => (
                  <Label
                    key={value}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-rule px-4 py-3 transition-colors',
                      stance === value && 'border-accent bg-accent/10 text-accent',
                    )}
                  >
                    <Input
                      type="radio"
                      name="stanceChoice"
                      value={value}
                      checked={stance === value}
                      required
                      className="size-4 min-w-4 shrink-0 p-0 accent-accent"
                      onChange={() => setStance(value)}
                    />
                    <span>{t(`stances.${value}`)}</span>
                  </Label>
                ))}
              </Grid>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="evidence-product-name">
                {t('productNameLabel')}
                <span aria-hidden="true" className="text-danger"> *</span>
              </Label>
              <Input
                id="evidence-product-name"
                name="productName"
                required
                placeholder={t('productNamePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evidence-source-type">
                {t('sourceTypeLabel')}
                <span aria-hidden="true" className="text-danger"> *</span>
              </Label>
              <NativeSelect
                id="evidence-source-type"
                name="sourceType"
                required
                defaultValue="product_label"
              >
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
                  className="type-metadata tabular-nums text-ink-muted"
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
              <p className="type-body-sm font-medium text-ink">{t('photoLabel')}</p>
                            <UploadDropzone
                id="evidence-photo"
                accept="image/*"
                disabled={uploading}
                hint={uploading ? t('uploading') : t('photoHint')}
                onFileSelect={handleFileSelect}
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
          </DialogBody>

          <DialogFooter>
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
        </DialogForm>
      )}
    </DialogContent>
  )
}
