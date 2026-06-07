import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import { getUserSubmissions } from '@/lib/services/submissions'
import { Badge } from '@/components/ui/badge'

type MySubmissionsPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: MySubmissionsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('mySubmissions')
  return {
    title: t('metadata.title'),
    description: t('subheading'),
    alternates: buildAlternates('/my-submissions', locale as Locale),
    robots: { index: false, follow: true },
  }
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#F5F4F1] text-[#7C7570] border-[#D4CFC9]',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}

export default async function MySubmissionsPage({ params }: MySubmissionsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const next = locale === 'en' ? '/en/my-submissions' : '/my-submissions'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/auth/sign-in?next=${next}`)
  }

  const t = await getTranslations('mySubmissions')
  const submissions = await getUserSubmissions(user.email ?? '')

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-[#1A1918]">
        {t('heading')}
      </h1>
      <p className="mt-2 text-sm text-[#7C7570]">
        {t('subheading')}
      </p>

      {submissions.length === 0 ? (
        <div className="mt-8 rounded-xl border border-[#E8E5E0] bg-white p-8 text-center">
          <p className="text-sm text-[#7C7570]">
            {t('empty.message')}
          </p>
          <Link
            href="/submit"
            className="mt-4 inline-flex rounded-full bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
          >
            {t('empty.cta')}
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-xl border border-[#E8E5E0] bg-white px-5 py-4"
            >
              <div>
                <p className="font-medium text-[#1A1918]">{sub.brandName}</p>
                <p className="mt-0.5 text-xs text-[#B0AAA4]">
                  {new Date(sub.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-TW')}
                </p>
              </div>
              <Badge
                variant="outline"
                className={STATUS_COLORS[sub.status] ?? STATUS_COLORS.pending}
              >
                {sub.status === 'approved'
                  ? t('status.approved')
                  : sub.status === 'rejected'
                    ? t('status.rejected')
                    : t('status.pending')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
