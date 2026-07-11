import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function SubmitBand() {
  const t = await getTranslations('landing.submitBand')

  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="page-gutter relative mx-auto max-w-3xl text-center">
        <h2 className="type-hero-inverse">
          {t('headline')}
        </h2>
        <p className="mt-4 type-body-inverse">
          {t('body')}
        </p>
        <Link
          href="/submit"
          className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-8')}
        >
          {t('cta')}
        </Link>
      </div>
    </section>
  )
}
