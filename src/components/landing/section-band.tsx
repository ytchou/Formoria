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
    <section className="bg-secondary py-12 md:py-16">
      <div className="page-shell">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16 items-start">
          {/* Recommendation + feature request CTAs */}
          <div>
            <div>
              <h2 className="type-section">{tRecommend('headline')}</h2>
              <p className="mt-2 type-body-sm">{tRecommend('body')}</p>
              <SectionBandCtaLink
                href="/submit"
                label={tRecommend('cta')}
                ctaName="submit_brand"
                className={cn(buttonVariants({ variant: 'primary' }), 'mt-4')}
              />
            </div>

            <div className="mt-10 border-t border-border pt-10">
              <h2 className="type-section">{tFeatureRequest('headline')}</h2>
              <p className="mt-2 type-body-sm">{tFeatureRequest('body')}</p>
              <SectionBandCtaLink
                href="/feature-requests"
                label={tFeatureRequest('cta')}
                ctaName="feature_request"
                className={cn(buttonVariants({ variant: 'primary' }), 'mt-4')}
              />
            </div>
          </div>

          {/* Newsletter */}
          <div>
            <h2 className="type-section">{tNewsletter('heading')}</h2>
            <p className="mt-2 type-body-sm">{tNewsletter('subtext')}</p>
            <div className="mt-4">
              <EmailCaptureForm />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
