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
        {/* `min-w-0` on the items is load-bearing. A grid item's automatic
            minimum size is its content's min-content width, and the newsletter
            column holds an `overflow-x-auto` chip row whose four `shrink-0`
            chips measure 398px — wider than the 345px this shell leaves at
            393px. The item sized to the chips instead of the track, so the
            scroll container never got to scroll and the PAGE scrolled sideways
            instead (mobile.spec.ts read body.scrollWidth 422 against a 393px
            viewport). Putting `min-w-0` on the chip row does NOT fix it —
            measured, it stays 422; the automatic minimum lives on the grid item.
            Both columns carry it so the next block dropped into either one
            cannot reintroduce the same overflow. */}
        <div className="grid gap-10 md:grid-cols-2 md:gap-16 items-start">
          {/* Recommendation + feature request CTAs */}
          <div className="min-w-0">
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

            <div className="mt-10 border-t border-border pt-10">
              <h2 className="type-section-title-large">{tFeatureRequest('headline')}</h2>
              <p className="mt-2 type-body-muted">{tFeatureRequest('body')}</p>
              <SectionBandCtaLink
                href="/feature-requests"
                label={tFeatureRequest('cta')}
                ctaName="feature_request"
                className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-4')}
              />
            </div>
          </div>

          {/* Newsletter */}
          <div className="min-w-0">
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
