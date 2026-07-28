'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Lightbulb } from 'lucide-react'
import { useId, useState, useTransition, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/ui/typography'
import { signInHref } from '@/i18n/locale-preference'
import { usePathname } from '@/i18n/navigation'
import { submitFeatureRequestAction } from '@/lib/actions/feature-requests'
import { trackFeatureRequestSubmitted } from '@/lib/analytics'
import { useUser } from '@/lib/auth/use-user'
import {
  FEATURE_REQUEST_BODY_MAX,
  FEATURE_REQUEST_TITLE_MAX,
  FEATURE_REQUEST_TITLE_MIN,
  type FeatureRequestCategory,
} from '@/lib/services/feature-requests'

/**
 * Action error code -> copy key. The action's error vocabulary is a closed
 * union, so a new code fails the type check here rather than silently
 * rendering a missing-message placeholder.
 */
const FEATURE_REQUEST_ERROR_KEYS = {
  unauthenticated: 'errors.unauthenticated',
  invalid_input: 'errors.invalid_input',
  rate_limited: 'errors.rate_limited',
  not_found: 'errors.not_found',
  merged: 'errors.merged',
  already_submitted: 'errors.already_submitted',
  unavailable: 'errors.unavailable',
} as const

export function SubmitRequestDialog() {
  const t = useTranslations('feedback.submit')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: userLoading } = useUser()
  const baseId = useId()
  const titleId = `${baseId}-title`
  const titleHintId = `${baseId}-title-hint`
  const titleErrorId = `${baseId}-title-error`
  const detailsId = `${baseId}-details`
  const detailsHintId = `${baseId}-details-hint`
  const categoryId = `${baseId}-category`
  const disclosureId = `${baseId}-disclosure`

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<FeatureRequestCategory>('visitor')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const signedOut = !userLoading && !user

  function reset() {
    setTitle('')
    setBody('')
    setCategory('visitor')
    setTitleError(null)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return

    const trimmedTitle = title.trim()
    if (
      trimmedTitle.length < FEATURE_REQUEST_TITLE_MIN ||
      trimmedTitle.length > FEATURE_REQUEST_TITLE_MAX
    ) {
      setTitleError(t('errors.title'))
      return
    }
    setTitleError(null)

    const trimmedBody = body.trim()

    startTransition(async () => {
      try {
        const result = await submitFeatureRequestAction({
          title: trimmedTitle,
          ...(trimmedBody ? { body: trimmedBody } : {}),
          category,
        })

        if (result.ok) {
          trackFeatureRequestSubmitted(result.id, category)
          toast.success(t('success'))
          handleOpenChange(false)
          // The board is a server component: without this the submitter is
          // told their request is up and then does not see it until a reload.
          router.refresh()
          return
        }

        toast.error(t(FEATURE_REQUEST_ERROR_KEYS[result.error]))
      } catch {
        toast.error(t(FEATURE_REQUEST_ERROR_KEYS.unavailable))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className={buttonVariants({ tone: 'cta' })}>
        <Lightbulb className="size-4" aria-hidden="true" />
        {t('trigger')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={titleId}>{t('titleLabel')}</Label>
            <Input
              id={titleId}
              name="title"
              value={title}
              maxLength={FEATURE_REQUEST_TITLE_MAX}
              // Deliberately not `required`: the native bubble would say
              // "please fill out this field" instead of the length rule the
              // submitter actually has to satisfy.
              aria-invalid={titleError ? true : undefined}
              aria-describedby={
                titleError ? `${titleHintId} ${titleErrorId}` : titleHintId
              }
              onChange={(event) => {
                setTitle(event.currentTarget.value)
                if (titleError) setTitleError(null)
              }}
              data-ph-no-autocapture
            />
            <Typography id={titleHintId} variant="formHint">
              {t('titleHint')}
            </Typography>
            {titleError ? (
              <Typography id={titleErrorId} variant="error" role="alert">
                {titleError}
              </Typography>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={detailsId}>{t('detailsLabel')}</Label>
            <Textarea
              id={detailsId}
              name="body"
              rows={4}
              maxLength={FEATURE_REQUEST_BODY_MAX}
              value={body}
              aria-describedby={detailsHintId}
              onChange={(event) => setBody(event.currentTarget.value)}
              data-ph-no-autocapture
            />
            <Typography id={detailsHintId} variant="formHint">
              {t('detailsHint')}
            </Typography>
          </div>

          <div className="space-y-2">
            <Label htmlFor={categoryId}>{t('categoryLabel')}</Label>
            <NativeSelect
              id={categoryId}
              name="category"
              value={category}
              onChange={(event) =>
                setCategory(event.currentTarget.value as FeatureRequestCategory)
              }
            >
              <option value="owner">{t('categoryOwner')}</option>
              <option value="visitor">{t('categoryVisitor')}</option>
            </NativeSelect>
          </div>

          {/* Locked requirement, not decoration: the board shows the request
              without a name, and the account is kept so we can follow up. */}
          <Typography
            id={disclosureId}
            variant="caption"
            className="rounded-lg bg-muted p-3 text-muted-foreground"
          >
            {t('anonymityDisclosure')}
          </Typography>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              {t('cancel')}
            </DialogClose>
            {signedOut ? (
              <NextLink
                href={signInHref(pathname, locale)}
                className={buttonVariants({ tone: 'cta' })}
              >
                {t('signInCta')}
              </NextLink>
            ) : (
              <SubmitButton
                isSubmitting={isPending}
                idleLabel={t('idle')}
                submittingLabel={t('submitting')}
                disabled={isPending || userLoading}
                data-ph-no-autocapture
              />
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
