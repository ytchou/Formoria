import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'
import { SectionBandCtaLink } from '@/components/landing/section-band-cta-link'
import { PageShell } from '@/components/ui/page-shell'
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
      {/* The band's `surface` runs edge to edge; only its CONTENT takes the
          page shell, which is what keeps its left edge on the zones above. */}
      <PageShell measure="page">
        {/* `min-w-0` on the items is load-bearing (DEV-1489). A grid item's
            automatic minimum size is its content's min-content width, and the
            newsletter column holds an `overflow-x-auto` chip row whose four
            `shrink-0` chips measure 398px — wider than the 345px this shell
            leaves at 393px. The item sized to the chips instead of the track, so
            the scroll container never got to scroll and the PAGE scrolled
            sideways instead (mobile.spec.ts read body.scrollWidth 422 against a
            393px viewport). Putting `min-w-0` on the chip row does NOT fix it —
            measured, it stays 422; the automatic minimum lives on the grid item.
            Both columns carry it so the next block dropped into either one
            cannot reintroduce the same overflow. */}
        <div className="grid gap-stack md:grid-cols-2 md:gap-16 items-start">
          <div className="min-w-0">
            <h2 className="type-section">{tRecommend('headline')}</h2>
            <p className="mt-3 prose-measure type-body-sm">{tRecommend('body')}</p>
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
          <div className="min-w-0">
            <h2 className="type-section">{tNewsletter('heading')}</h2>
            <p className="mt-3 type-body-sm">{tNewsletter('subtext')}</p>
            <div className="mt-6">
              <EmailCaptureForm />
            </div>
          </div>
        </div>
      </PageShell>
    </section>
  )
}
