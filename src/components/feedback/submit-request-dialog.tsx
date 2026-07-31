'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Lightbulb } from 'lucide-react'
import { useId, useState, useTransition, type FormEvent } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/forms/form-field'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/ui/typography'
import { submitFeatureRequestAction } from '@/lib/actions/feature-requests'
import { trackFeatureRequestSubmitted } from '@/lib/analytics'
import { useUser } from '@/lib/auth/use-user'
import {
  FEATURE_REQUEST_BODY_MAX,
  FEATURE_REQUEST_BODY_MIN,
  FEATURE_REQUEST_TITLE_MAX,
  FEATURE_REQUEST_TITLE_MIN,
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

/**
 * Shape check only — deliverability is the reply attempt's problem. Mirrors the
 * pattern used by the other client-side email fields so a guest gets the same
 * verdict here as the server's zod `.email()` would give.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function SubmitRequestDialog() {
  const t = useTranslations('feedback.submit')
  const router = useRouter()
  const { user, loading: userLoading } = useUser()
  const baseId = useId()
  const titleId = `${baseId}-title`
  const detailsId = `${baseId}-details`
  const contactEmailId = `${baseId}-contact-email`
  const disclosureId = `${baseId}-disclosure`

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [contactEmailError, setContactEmailError] = useState<string | null>(
    null,
  )
  const [isPending, startTransition] = useTransition()

  const signedOut = !userLoading && !user

  function reset() {
    setTitle('')
    setBody('')
    setContactEmail('')
    setTitleError(null)
    setBodyError(null)
    setContactEmailError(null)
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
    if (trimmedBody.length < FEATURE_REQUEST_BODY_MIN) {
      setBodyError(t('errors.details'))
      return
    }
    setBodyError(null)

    // Only guests are asked for one, and it stays optional: an empty field is
    // a valid submission, a malformed one is not.
    const trimmedEmail = signedOut ? contactEmail.trim() : ''
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setContactEmailError(t('errors.contactEmail'))
      return
    }
    setContactEmailError(null)

    startTransition(async () => {
      try {
        const result = await submitFeatureRequestAction({
          title: trimmedTitle,
          body: trimmedBody,
          ...(trimmedEmail ? { guestEmail: trimmedEmail } : {}),
        })

        if (result.ok) {
          trackFeatureRequestSubmitted(result.id)
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

        {/* `noValidate`: the title and details fields are `required` and the
            email field is `type="email"` so guests get the right keyboard and
            autofill, but native validation would swallow the submit and show
            an untranslated browser bubble instead of our own error copy. */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <FormField
            id={titleId}
            label={t('titleLabel')}
            required
            error={titleError}
          >
            <Input
              id={titleId}
              name="title"
              value={title}
              maxLength={FEATURE_REQUEST_TITLE_MAX}
              // Real `required` so assistive tech gets the constraint —
              // `FormField`'s asterisk is `aria-hidden`. The form's
              // `noValidate` is what keeps the native bubble away.
              required
              onChange={(event) => {
                setTitle(event.currentTarget.value)
                if (titleError) setTitleError(null)
              }}
              data-ph-no-autocapture
            />
          </FormField>

          <FormField
            id={detailsId}
            label={t('detailsLabel')}
            description={t('detailsHint')}
            required
            error={bodyError}
          >
            <Textarea
              id={detailsId}
              name="body"
              rows={4}
              maxLength={FEATURE_REQUEST_BODY_MAX}
              value={body}
              required
              onChange={(event) => {
                setBody(event.currentTarget.value)
                if (bodyError) setBodyError(null)
              }}
              data-ph-no-autocapture
            />
          </FormField>

          {signedOut ? (
            <FormField
              id={contactEmailId}
              label={t('contactEmailLabel')}
              description={t('contactEmailHint')}
              error={contactEmailError}
            >
              <Input
                id={contactEmailId}
                name="guestEmail"
                type="email"
                value={contactEmail}
                onChange={(event) => {
                  setContactEmail(event.currentTarget.value)
                  if (contactEmailError) setContactEmailError(null)
                }}
                data-ph-no-autocapture
              />
            </FormField>
          ) : null}

          {/* Locked requirement, not decoration: the board shows the request
              without a name and without the address a guest may leave above.
              Scoped to what gets published — what we retain internally is the
              privacy policy's job, not this dialog's. */}
          <Typography
            id={disclosureId}
            variant="caption"
            className="rounded-lg bg-muted p-3 text-muted-foreground"
          >
            {t('anonymityDisclosure')}
          </Typography>

          <DialogFooter>
            <SubmitButton
              isSubmitting={isPending}
              idleLabel={t('idle')}
              submittingLabel={t('submitting')}
              // Still gated on `userLoading`: which branch renders above
              // depends on knowing whether there is a user, so submitting
              // before that resolves could drop a guest's email.
              disabled={isPending || userLoading}
              data-ph-no-autocapture
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
