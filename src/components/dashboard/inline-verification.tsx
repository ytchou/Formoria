'use client'

import {
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { X } from 'lucide-react'
import { useMounted } from '@/hooks/use-mounted'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SurfaceCard } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { StatusPill } from '@/components/ui/status-pill'
import { Textarea } from '@/components/ui/textarea'
import { verifyMitAction } from '@/app/[locale]/(protected)/dashboard/actions'
import {
  declareMitAction,
  withdrawDeclarationAction,
} from '@/app/[locale]/(protected)/dashboard/brands/[slug]/actions'

type MitScope = 'all' | 'most' | 'some'

type InlineVerificationProps = {
  brandId: string
  embedded?: boolean
  mitStatus: 'unverified' | 'declared' | 'verified'
  mitEvidence?: { mit_smile_cert?: string; mit_smile_listed?: boolean }
  mitDeclaredScope?: MitScope | null
  mitDeclaredAt?: string | null
  mitStory?: string | null
}

export function InlineVerification({
  brandId,
  embedded = false,
  mitStatus,
  mitEvidence,
  mitDeclaredScope,
  mitDeclaredAt,
  mitStory,
}: InlineVerificationProps) {
  const t = useTranslations('dashboard.mit')
  const params = useParams<{ slug: string }>()
  const mounted = useMounted()
  const scopeId = useId()
  const storyId = useId()

  const DISMISS_KEY = `formoria:dismiss-verification:${brandId}`

  const dismissed = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('storage', onStoreChange)
      window.addEventListener('formoria:verification-dismissed', onStoreChange)
      return () => {
        window.removeEventListener('storage', onStoreChange)
        window.removeEventListener('formoria:verification-dismissed', onStoreChange)
      }
    },
    () => window.localStorage.getItem(DISMISS_KEY) === '1',
    () => false,
  )
  const [certNumber, setCertNumber] = useState('')
  const [scope, setScope] = useState<MitScope>(mitDeclaredScope ?? 'all')
  const [attested, setAttested] = useState(false)
  const [story, setStory] = useState(mitStory ?? '')
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const brandSlug = typeof params.slug === 'string' ? params.slug : ''

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1')
    window.dispatchEvent(new Event('formoria:verification-dismissed'))
  }

  function handleVerify() {
    setError(null)
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await verifyMitAction(brandId, certNumber)
      if (result?.error) {
        setError(
          result.error === 'cert_not_found' ? t('certNotFound')
          : result.error === 'cert_expired' ? t('certExpired')
          : t('certNotFound'),
        )
      } else {
        setSuccessMessage(t('verifySuccess'))
      }
    })
  }

  function handleDeclare() {
    setError(null)
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await declareMitAction(brandSlug, scope)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccessMessage(t('declare.success'))
      }
    })
  }

  function handleWithdraw() {
    setError(null)
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await withdrawDeclarationAction(brandSlug)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccessMessage(t('declared.withdrawSuccess'))
      }
    })
  }

  if (mitStatus === 'verified') {
    return (
      <div
        id="verification"
        className={embedded ? '' : 'mt-3.5'}
      >
        <StatusPill variant="verified" label={t('status.verified')}>
          {mitEvidence?.mit_smile_cert && (
            <span className="rounded bg-verified-green-bg px-2 py-0.5 font-mono type-caption text-verified-green">
              {mitEvidence.mit_smile_cert}
            </span>
          )}
        </StatusPill>
      </div>
    )
  }

  if (!mounted) return null
  if (!embedded && dismissed) return null

  const content = (
    <>
      <div className="mb-4 flex items-center gap-2">
        <StatusPill
          variant={mitStatus === 'declared' ? 'declared' : 'unverified'}
          label={`${t('title')} — ${t(`status.${mitStatus}`)}`}
        />
        {!embedded ? (
          <Button
            type="button"
            onClick={dismiss}
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-foreground [&_svg:not([class*=size-])]:size-3.5"
            aria-label={t('dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      {mitStatus === 'declared' ? (
        <div className="space-y-3">
          <dl className="grid gap-2 type-caption sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('declared.scopeLabel')}</dt>
              <dd className="type-body-emphasis">
                {t(`declare.scope.${mitDeclaredScope ?? 'all'}`)}
              </dd>
            </div>
            {mitDeclaredAt ? (
              <div>
                <dt className="text-muted-foreground">{t('declared.dateLabel')}</dt>
                <dd className="type-body-emphasis">
                  {new Intl.DateTimeFormat().format(new Date(mitDeclaredAt))}
                </dd>
              </div>
            ) : null}
          </dl>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={!brandSlug || isPending}
            onClick={handleWithdraw}
          >
            {t('declared.withdraw')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
          <section className="space-y-3" aria-labelledby={`${scopeId}-cert-title`}>
            <div>
              <h3 id={`${scopeId}-cert-title`} className="type-body-emphasis">
                {t('tier.certTitle')}
              </h3>
              <p className="mt-1 type-caption text-muted-foreground">
                {t('tier.certDescription')}
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (certNumber.trim() && !isPending) handleVerify()
              }}
              className="space-y-2"
            >
              <Label htmlFor={`${scopeId}-cert`} className="type-caption">
                {t('certLabel')}
              </Label>
              <Input
                id={`${scopeId}-cert`}
                value={certNumber}
                onChange={(event) => setCertNumber(event.target.value)}
                placeholder={t('certPlaceholder')}
                className="font-mono type-caption"
              />
              <Button type="submit" size="compact" disabled={!certNumber.trim() || isPending}>
                {t('verifyButton')}
              </Button>
            </form>
          </section>

          <div className="flex items-center gap-3 text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border md:h-full md:w-px md:flex-none" />
            <span className="type-caption">{t('or')}</span>
            <span className="h-px flex-1 bg-border md:hidden" />
          </div>

          <section className="space-y-3" aria-labelledby={`${scopeId}-declare-title`}>
            <div>
              <h3 id={`${scopeId}-declare-title`} className="type-body-emphasis">
                {t('tier.declareTitle')}
              </h3>
              <p className="mt-1 type-caption text-muted-foreground">
                {t('tier.declareDescription')}
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (attested && !isPending) handleDeclare()
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={scopeId} className="type-caption">
                  {t('declare.scopeLabel')}
                </Label>
                <NativeSelect
                  id={scopeId}
                  value={scope}
                  onChange={(event) => setScope(event.target.value as MitScope)}
                >
                  <option value="all">{t('declare.scope.all')}</option>
                  <option value="most">{t('declare.scope.most')}</option>
                  <option value="some">{t('declare.scope.some')}</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={storyId} className="type-caption">
                  {t('declare.storyLabel')}
                </Label>
                <Textarea
                  id={storyId}
                  value={story}
                  onChange={(event) => setStory(event.target.value)}
                  placeholder={t('declare.storyPlaceholder')}
                />
              </div>
              <Label className="flex min-h-12 items-start gap-2 type-caption">
                <Checkbox
                  checked={attested}
                  onCheckedChange={setAttested}
                  className="mt-1 shrink-0"
                />
                <span>{t('declare.attestation')}</span>
              </Label>
              <Button
                type="submit"
                tone="cta"
                size="compact"
                disabled={!attested || !brandSlug || isPending}
              >
                {t('declare.submit')}
              </Button>
            </form>
          </section>
        </div>
      )}

      {error ? <p className="mt-3 animate-error-shake type-error">{error}</p> : null}
      {successMessage ? (
        <div className="mt-3 animate-reveal-up">
          <StatusPill variant="verified" label={successMessage} />
        </div>
      ) : null}
    </>
  )

  if (embedded) {
    return <div id="verification">{content}</div>
  }

  return (
    <SurfaceCard id="verification" padding="sm" className="mt-3.5">
      {content}
    </SurfaceCard>
  )
}
