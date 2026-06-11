import type { Brand, SiteContent } from '@/lib/types/brand'

type ContactCtaProps = {
  brand: Brand
  siteContent: Pick<SiteContent, 'ctaValue'>
}

export function ContactCta({ brand, siteContent }: ContactCtaProps) {
  const email = siteContent.ctaValue ?? brand.contactEmail

  return (
    <section id="contact" className="px-6 py-12 md:px-10 md:py-16" aria-labelledby="contact-title">
      <div className="mx-auto max-w-[1280px]">
        <div className="rounded-xl border border-border bg-card p-6 md:p-8">
          <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h2 id="contact-title" className="text-base font-bold leading-tight text-foreground">
                與品牌聯繫
              </h2>
              <p className="text-sm leading-[1.7] text-muted-foreground">
                歡迎洽詢商品、合作與客製需求。
              </p>
            </div>
            {email && (
              <a
                href={`mailto:${email}`}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--brand-accent)] px-6 py-3 text-sm font-semibold text-[var(--brand-accent-foreground)] transition-transform active:scale-[0.98]"
              >
                聯絡品牌
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
