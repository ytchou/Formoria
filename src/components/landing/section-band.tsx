import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'
import { SectionBandCtaLink } from '@/components/landing/section-band-cta-link'
import { cn } from '@/lib/utils'

export default async function SectionBand() {
  const tRecommend = await getTranslations('landing.submitBand')
  const tNewsletter = await getTranslations('newsletter')
  const tFeatureRequest = await getTranslations('landing.featureRequestBand')

  return (
    /*
      The closing zone: three ways to stay involved, read as one. The band no
      longer paints itself a different colour — zones are separated by
      whitespace and a single rule, never by alternating backgrounds
      (DESIGN.md) — and the three invitations now sit side by side instead of
      stacking two in a column beside the newsletter.
    */
    <section className="mt-6 border-t border-border py-12 md:mt-8 md:py-16">
      <div className="mx-auto max-w-6xl page-gutter">
        <div className="grid gap-10 md:grid-cols-3 md:gap-12 items-start">
          {/* Recommend a brand */}
          <div>
            <h2 className="type-section-title-large">{tRecommend('headline')}</h2>
            <p className="mt-2 type-body-muted">{tRecommend('body')}</p>
            <SectionBandCtaLink
              href="/submit"
              label={tRecommend('cta')}
              ctaName="submit_brand"
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-4')}
            />
          </div>

          {/* Feature request */}
          <div>
            <h2 className="type-section-title-large">{tFeatureRequest('headline')}</h2>
            <p className="mt-2 type-body-muted">{tFeatureRequest('body')}</p>
            <SectionBandCtaLink
              href="/feature-requests"
              label={tFeatureRequest('cta')}
              ctaName="feature_request"
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-4')}
            />
          </div>

          {/* Newsletter — its only surface on `/`. */}
          <div>
            <h2 className="type-section-title-large">{tNewsletter('heading')}</h2>
            <p className="mt-2 type-body-muted">{tNewsletter('subtext')}</p>
            <div className="mt-4">
              <EmailCaptureForm />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
