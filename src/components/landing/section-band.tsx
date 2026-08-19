import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'
import { SectionBandCtaLink } from '@/components/landing/section-band-cta-link'
import { routes } from '@/lib/routes'

/**
 * THE CLOSING CTA BAND.
 *
 * One question, two answers, on `surface` — the second material, and the only
 * background on the page besides the trust band. The recommendation ask and the
 * feature request used to be two stacked blocks with a heading each, which read
 * as two competing sections at the foot of the page; they are one block with two
 * buttons now, so `landing.featureRequestBand.headline` and `.body` are gone and
 * only its `cta` survives as the secondary button's label.
 *
 * The newsletter stays a real form rather than the mock's monthly-selection
 * subscribe button: `e2e/tests/newsletter-subscribe.spec.ts` subscribes through
 * it from `/`, and a button would need a destination that does not exist.
 */
export default async function SectionBand() {
  const tRecommend = await getTranslations('landing.submitBand')
  const tNewsletter = await getTranslations('newsletter')
  const tFeatureRequest = await getTranslations('landing.featureRequestBand')

  return (
    <section className="bg-surface py-section">
      <div className="page-shell">
        <div className="grid gap-stack md:grid-cols-2 md:gap-16 items-start">
          <div>
            <h2 className="type-section">{tRecommend('headline')}</h2>
            <p className="mt-3 max-w-xl type-body-sm">{tRecommend('body')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <SectionBandCtaLink
                href={routes.submit.index()}
                label={tRecommend('cta')}
                ctaName="submit_brand"
                className={buttonVariants({ variant: 'primary' })}
              />
              <SectionBandCtaLink
                href={routes.featureRequests()}
                label={tFeatureRequest('cta')}
                ctaName="feature_request"
                className={buttonVariants({ variant: 'secondary' })}
              />
            </div>
          </div>

          {/* Newsletter */}
          <div>
            <h2 className="type-section">{tNewsletter('heading')}</h2>
            <p className="mt-3 type-body-sm">{tNewsletter('subtext')}</p>
            <div className="mt-6">
              <EmailCaptureForm />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
