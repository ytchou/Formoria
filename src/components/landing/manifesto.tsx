import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function Manifesto() {
  const t = await getTranslations('landing.manifesto')

  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/manifesto-bg.png"
        alt=""
        fill
        priority
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="page-gutter relative mx-auto max-w-3xl text-center">
        <h2 className="type-hero-inverse">
          {t('headline')}
        </h2>
        <p className="mt-4 type-body-inverse">
          {t('body1')}
        </p>
        <p className="mt-3 type-body-inverse">
          {t('body2')}
        </p>
        <p className="mt-3 type-body-inverse">
          {t('body3')}
        </p>
        <Link
          href="/about"
          className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-8')}
        >
          {t('cta')}
        </Link>
      </div>
    </section>
  )
}
