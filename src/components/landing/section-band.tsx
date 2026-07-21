import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'
import { SectionBandCtaLink } from '@/components/landing/section-band-cta-link'
import { cn } from '@/lib/utils'

export default async function SectionBand() {
  const tSubmit = await getTranslations('landing.submitBand')
  const tNewsletter = await getTranslations('newsletter')

  return (
    <section className="bg-secondary py-12 md:py-16">
      <div className="mx-auto max-w-6xl page-gutter">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16 items-start">
          {/* Submit CTA */}
          <div>
            <h2 className="type-section-title-large">{tSubmit('headline')}</h2>
            <p className="mt-2 type-body-muted">{tSubmit('body')}</p>
            <SectionBandCtaLink
              href="/submit"
              label={tSubmit('cta')}
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-4')}
            />
          </div>

          {/* Newsletter */}
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
