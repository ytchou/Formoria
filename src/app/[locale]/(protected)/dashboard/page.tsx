import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import { getUserBrands } from '@/lib/services/brand-owners'
import type { Brand, CustomerVoice, OtherUrl, RetailLocation } from '@/lib/types/brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ brand?: string }>
}

type LinkItem = {
  label: string
  href: string
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard')

  return {
    title: t('metadata.title'),
  }
}

type PurchaseLinkLabels = { website: string; pinkoi: string; shopee: string; link: string }

function getPurchaseLinks(brand: Brand, labels: PurchaseLinkLabels): LinkItem[] {
  const links: LinkItem[] = [
    brand.purchaseWebsite ? { label: labels.website, href: brand.purchaseWebsite } : null,
    brand.purchasePinkoi ? { label: labels.pinkoi, href: brand.purchasePinkoi } : null,
    brand.purchaseShopee ? { label: labels.shopee, href: brand.purchaseShopee } : null,
    ...brand.otherUrls.map((link: OtherUrl) =>
      link.url ? { label: link.label || labels.link, href: link.url } : null
    ),
  ].filter((link): link is LinkItem => link !== null)

  return links
}

function getSocialHref(platform: 'instagram' | 'threads' | 'facebook', value: string): string {
  if (/^https?:\/\//i.test(value)) return value

  const handle = value.replace(/^@/, '')
  if (platform === 'instagram') return `https://www.instagram.com/${handle}`
  if (platform === 'threads') return `https://www.threads.net/@${handle}`
  return `https://www.facebook.com/${handle}`
}

function getSocialLinks(brand: Brand): LinkItem[] {
  return [
    brand.socialInstagram
      ? { label: 'Instagram', href: getSocialHref('instagram', brand.socialInstagram) }
      : null,
    brand.socialThreads
      ? { label: 'Threads', href: getSocialHref('threads', brand.socialThreads) }
      : null,
    brand.socialFacebook
      ? { label: 'Facebook', href: getSocialHref('facebook', brand.socialFacebook) }
      : null,
  ].filter((link): link is LinkItem => link !== null)
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base font-bold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground">
      {children}
    </span>
  )
}

function LinkList({ links, emptyText }: { links: LinkItem[]; emptyText: string }) {
  if (links.length === 0) {
    return <p className="text-sm font-normal text-muted-foreground">{emptyText}</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${link.label}-${link.href}`}
          className="inline-flex rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          href={link.href}
          rel="noreferrer"
          target="_blank"
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}

function CustomerVoices({ voices, title }: { voices: CustomerVoice[]; title: string }) {
  if (voices.length === 0) return null

  return (
    <Section title={title}>
      <div className="grid gap-3 md:grid-cols-3">
        {voices.slice(0, 3).map((voice, index) => (
          <article
            key={`${voice.author}-${index}`}
            className="rounded-xl border border-border bg-white p-5"
          >
            <p className="text-sm font-normal leading-6 text-foreground">{voice.content}</p>
            <p className="mt-4 text-[13px] font-medium text-muted-foreground">
              {voice.author}
              {voice.source ? `, ${voice.source}` : ''}
            </p>
          </article>
        ))}
      </div>
    </Section>
  )
}

function ProductPhotos({
  photos,
  brandName,
  title,
}: {
  photos: string[]
  brandName: string
  title: string
}) {
  if (photos.length === 0) return null

  return (
    <Section title={title}>
      <div className="grid max-w-[400px] grid-cols-2 gap-3">
        {photos.slice(0, 4).map((photo, index) => (
          <div
            key={`${photo}-${index}`}
            className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
          >
            <Image
              alt={`${brandName} product ${index + 1}`}
              className="object-cover"
              fill
              sizes="200px"
              src={photo}
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

function RetailLocations({ locations, title }: { locations: RetailLocation[]; title: string }) {
  if (locations.length === 0) return null

  return (
    <Section title={title}>
      <div className="space-y-3">
        {locations.map((location, index) => (
          <div
            key={`${location.name}-${location.address}-${index}`}
            className="rounded-xl border border-border bg-white p-5"
          >
            <p className="text-sm font-semibold text-foreground">{location.name}</p>
            <p className="mt-1 text-sm font-normal text-muted-foreground">{location.address}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard.brandProfile')

  const resolvedSearchParams = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ownedBrands = user ? await getUserBrands(user.id) : []
  const selectedOwnedBrand =
    ownedBrands.find((brand) => brand.brandSlug === resolvedSearchParams.brand) ??
    ownedBrands[0]

  if (!selectedOwnedBrand) {
    return (
      <div className="rounded-xl border border-border bg-white p-10 text-center">
        <p className="text-sm font-normal text-muted-foreground">No brand profile found.</p>
      </div>
    )
  }

  const brand = await getBrandBySlug(selectedOwnedBrand.brandSlug)
  const purchaseLinks = getPurchaseLinks(brand, {
    website: t('website'),
    pinkoi: t('pinkoi'),
    shopee: t('shopee'),
    link: t('link'),
  })
  const socialLinks = getSocialLinks(brand)
  const priceRange = brand.priceRange ? '$'.repeat(brand.priceRange) : t('notSet')

  return (
    <div className="grid max-w-[1240px] gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="w-full lg:w-[400px]">
        {brand.heroImageUrl ? (
          <div className="relative h-[266px] w-full overflow-hidden rounded-xl bg-muted lg:w-[400px]">
            <Image
              alt={brand.name}
              className="object-cover"
              fill
              priority
              sizes="400px"
              src={brand.heroImageUrl}
            />
          </div>
        ) : null}
      </div>

      <div className="min-w-0 space-y-8">
        <section className="space-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-[26px] font-bold leading-tight text-foreground">
                {brand.name}
              </h1>
              {brand.isVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {t('verified')}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {brand.category ? <Pill>{brand.category}</Pill> : null}
              {brand.foundingYear ? <Pill>{t('founded')} {brand.foundingYear}</Pill> : null}
            </div>
          </div>

          {brand.description ? (
            <p className="max-w-3xl text-sm font-normal leading-6 text-foreground">
              {brand.description}
            </p>
          ) : null}

          {brand.productTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {brand.productTags.map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
            </div>
          ) : null}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title={t('priceRange')}>
            <p className="text-sm font-normal text-foreground">{priceRange}</p>
          </Section>
          <Section title={t('purchaseLinks')}>
            <LinkList links={purchaseLinks} emptyText={t('noLinksAdded')} />
          </Section>
          <Section title={t('socialLinks')}>
            <LinkList links={socialLinks} emptyText={t('noLinksAdded')} />
          </Section>
        </div>

        <CustomerVoices voices={brand.customerVoices} title={t('customerVoices')} />
        <ProductPhotos photos={brand.productPhotos} brandName={brand.name} title={t('productPhotos')} />
        <RetailLocations locations={brand.retailLocations} title={t('retailLocations')} />
      </div>
    </div>
  )
}
