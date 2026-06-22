'use client'

import { useState, useMemo, useTransition, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, FormProvider, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Send } from 'lucide-react'
import { UrlStep } from './UrlStep'
import type { UrlStepLinks } from './UrlStep'
import { BrandInfoStep } from './BrandInfoStep'
import { getFullSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { useRouter } from '@/i18n/navigation'
import { submitBrand } from '@/app/[locale]/submit/actions'
import { deriveCategoryFromProductType } from '@/lib/taxonomy/ontology'
import {
  trackSubmissionFormOpened,
  trackSubmissionCompleted,
  trackSubmissionFormAbandoned,
  SUBMISSION_STEP_NAMES,
  type SubmissionStepName,
} from '@/lib/analytics'
import type { TaxonomyTag } from '@/lib/types'
import type { ScrapedBrandData, PhotoItem } from '@/lib/types/scraper'
import type { SourceAttribution } from '@/lib/types/submission'

type SubmitWizardProps = {
  regionTags?: TaxonomyTag[]
  valueTags?: TaxonomyTag[]
  source?: 'header_cta' | 'hero_cta' | 'footer_link'
}

type WizardPhase = 'url' | 'form'

function mapScrapedToPhotos(data: ScrapedBrandData): PhotoItem[] {
  const photos: PhotoItem[] = []

  if (data.heroImageUrl) {
    photos.push({
      id: crypto.randomUUID(),
      url: data.heroImageUrl,
      source: 'scraped',
    })
  }

  for (const url of data.galleryImageUrls) {
    if (url !== data.heroImageUrl) {
      photos.push({
        id: crypto.randomUUID(),
        url,
        source: 'scraped',
      })
    }
  }

  return photos
}

export function SubmitWizard({
  regionTags = [],
  source = 'hero_cta',
}: SubmitWizardProps) {
  const t = useTranslations('submit')
  const router = useRouter()

  // Wrap to satisfy the plain (key: string) => string Translator contract
  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t]
  )

  const [phase, setPhase] = useState<WizardPhase>('url')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [completed, setCompleted] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [sourceAttribution, setSourceAttribution] = useState<SourceAttribution | undefined>(undefined)

  const mountTimeRef = useRef<number>(0)
  const lastStepRef = useRef<SubmissionStepName>(SUBMISSION_STEP_NAMES[0])

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened(source)
  }, [source])

  // Abandonment tracking via visibilitychange
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && !completed) {
        const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
        trackSubmissionFormAbandoned(lastStepRef.current, elapsed)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [completed])

  const fullSchema = useMemo(() => getFullSubmissionSchema(tSchema), [tSchema])

  const methods = useForm<SubmissionFormData>({
    resolver: zodResolver(fullSchema) as Resolver<SubmissionFormData>,
    defaultValues: {
      name: '',
      description: '',
      website: '',
      region: '',
      valueTags: [],
      heroImageUrl: '',
      productType: '',
      productTypeNote: '',
      productPhotos: [],
      purchaseLinks: [],
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      retailLocations: [],
      pdpaConsent: false,
      turnstileToken: '',
      _honeypot: '',
      isOwner: false,
      sourceAttribution: undefined,
    },
    mode: 'onTouched',
  })

  const handleOwnerChange = useCallback((nextIsOwner: boolean) => {
    setIsOwner(nextIsOwner)
    methods.setValue('isOwner', nextIsOwner, { shouldValidate: phase === 'form' })
    if (nextIsOwner) {
      setSourceAttribution(undefined)
      methods.setValue('sourceAttribution', undefined, { shouldValidate: phase === 'form' })
    }
  }, [methods, phase])

  const handleAttributionChange = useCallback((attribution: SourceAttribution | undefined) => {
    setSourceAttribution(attribution)
    methods.setValue('sourceAttribution', attribution, { shouldValidate: phase === 'form' })
  }, [methods, phase])

  const handleUrlSuccess = useCallback(
    (data: ScrapedBrandData, links: UrlStepLinks) => {
      if (data.brandName) {
        methods.setValue('name', data.brandName)
      }
      if (data.description) {
        methods.setValue('description', data.description)
      }
      const website = links.websiteUrl || data.websiteUrl
      methods.setValue('website', website)

      methods.setValue('socialLinks', {
        instagram: links.instagram || data.socialInstagram || '',
        threads: links.threads || data.socialThreads || '',
        facebook: links.facebook || data.socialFacebook || '',
        website,
      })

      const validPurchaseLinks = links.purchaseLinks.filter(l => l.platform || l.url)
      if (validPurchaseLinks.length > 0) {
        methods.setValue('purchaseLinks', validPurchaseLinks)
      }

      setPhotos(mapScrapedToPhotos(data))
      setPhase('form')
    },
    [methods]
  )

  const handleUrlSkip = useCallback((links: UrlStepLinks) => {
    if (links.websiteUrl || links.instagram || links.threads || links.facebook) {
      methods.setValue('website', links.websiteUrl)
      methods.setValue('socialLinks', {
        instagram: links.instagram,
        threads: links.threads,
        facebook: links.facebook,
        website: links.websiteUrl,
      })
    }
    const validPurchaseLinks = links.purchaseLinks.filter(l => l.platform || l.url)
    if (validPurchaseLinks.length > 0) {
      methods.setValue('purchaseLinks', validPurchaseLinks)
    }
    setPhase('form')
  }, [methods])

  // eslint-disable-next-line react-hooks/refs
  const handleSubmit = methods.handleSubmit((data) => {
    setSubmitError(null)
    lastStepRef.current = SUBMISSION_STEP_NAMES[1]

    const photoUrls = photos.map((p) => p.url)
    const website = data.website ?? data.socialLinks?.website ?? ''
    const mergedData = {
      ...(data as SubmissionFormData),
      website,
      socialLinks: {
        instagram: data.socialLinks?.instagram ?? '',
        threads: data.socialLinks?.threads ?? '',
        facebook: data.socialLinks?.facebook ?? '',
        website,
      },
      productType: (data as SubmissionFormData).productType ?? '',
      productTypeNote: (data as SubmissionFormData).productTypeNote ?? '',
      productPhotos: [...photoUrls, ...(data as SubmissionFormData).productPhotos.filter((url: string) => !photoUrls.includes(url))],
      isOwner,
      sourceAttribution,
    }

    startTransition(async () => {
      const result = await submitBrand(mergedData)
      if (result?.error) {
        setSubmitError(result.error)
      } else {
        setCompleted(true)
        const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
        trackSubmissionCompleted(
          data.name,
          deriveCategoryFromProductType(mergedData.productType ?? '', mergedData.productTypeNote) ?? data.category,
          Boolean(data.heroImageUrl),
          elapsed
        )
        router.push('/submit/confirmation')
      }
    })
  })

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="text-center">
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          {t('wizard.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('wizard.subheading')}
        </p>
      </div>

      {phase === 'url' ? (
        <div className="rounded-xl border border-border bg-white p-8 shadow-sm">
          <UrlStep
            onSuccess={handleUrlSuccess}
            onSkip={handleUrlSkip}
            isOwner={isOwner}
            onOwnerChange={handleOwnerChange}
            onAttributionChange={handleAttributionChange}
          />
        </div>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit}>
            <div className="rounded-xl border border-border bg-white p-8 shadow-sm">
              <BrandInfoStep
                regionTags={regionTags}
                isOwner={isOwner}
                onOwnerChange={handleOwnerChange}
                sourceAttribution={sourceAttribution}
                onAttributionChange={handleAttributionChange}
              />

              {submitError && (
                <p role="alert" className="mt-4 text-sm text-red-600">{submitError}</p>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-5 py-2.5 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                >
                  {isPending ? (
                    t('wizard.submitting')
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t('wizard.submitBrand')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </FormProvider>
      )}
    </div>
  )
}
