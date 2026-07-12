import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'
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
            <Link
              href="/submit"
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-4')}
            >
              {tSubmit('cta')}
            </Link>
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
