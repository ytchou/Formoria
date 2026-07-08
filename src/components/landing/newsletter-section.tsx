'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'

import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'

export function NewsletterSection() {
  const t = useTranslations('newsletter')

  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/manifesto-bg.png"
        alt=""
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative mx-auto max-w-3xl space-y-5 px-5">
        <h2 className="text-center type-hero-inverse">
          {t('heading')}
        </h2>
        <p className="text-center type-body-inverse">
          {t('subtext')}
        </p>
        <EmailCaptureForm />
      </div>
    </section>
  )
}
