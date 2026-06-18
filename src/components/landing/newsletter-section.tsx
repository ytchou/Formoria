'use client'

import { useTranslations } from 'next-intl'

import { EmailCaptureForm } from '@/components/newsletter/email-capture-form'

export function NewsletterSection() {
  const t = useTranslations('newsletter')

  return (
    <section className="bg-secondary py-16 md:py-12">
      <div className="mx-auto max-w-xl space-y-5 px-5">
        <h2 className="text-center font-heading text-[28px] font-bold text-foreground">
          {t('heading')}
        </h2>
        <p className="text-center text-sm text-muted-foreground">
          {t('subtext')}
        </p>
        <EmailCaptureForm />
      </div>
    </section>
  )
}
