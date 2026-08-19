import type { LucideIcon } from 'lucide-react'
import {
  Calendar,
  CircleCheck,
  DollarSign,
  FileText,
  Globe,
  ImageIcon,
  Link2,
  MapPin,
  Share2,
  ShieldCheck,
  Star,
  Tag,
} from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { SurfaceCard } from '@/components/ui/card'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'

type Recommendation = ProfileCompleteness['recommendations'][number]
type RecommendationKey = Recommendation['key']

const recommendationIcons: Record<RecommendationKey, LucideIcon> = {
  reputation: Star,
  productPhotos: ImageIcon,
  additionalSalesChannel: Link2,
  description: FileText,
  heroImage: ImageIcon,
  officialWebsite: Globe,
  city: MapPin,
  foundingYear: Calendar,
  socialPresence: Share2,
  subcategories: Tag,
  priceRange: DollarSign,
}

export async function TodoSection({
  completeness,
  slug,
  mitStatus,
}: {
  completeness: ProfileCompleteness
  slug: string
  mitStatus: string
}) {
  const [tOverview, tProfile] = await Promise.all([
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.profileCompleteness'),
  ])
  const showVerification =
    completeness.recommendations.length === 0 && mitStatus !== 'verified'
  const isEmpty =
    completeness.recommendations.length === 0 && !showVerification

  return (
    <section aria-labelledby="todo-section-title" id="profile-completeness">
      <h2 className="type-card-title" id="todo-section-title">
        {tOverview('todoTitle')}
      </h2>
      <SurfaceCard className="mt-4 rounded-lg" padding="lg">
        {isEmpty ? (
          <div className="flex items-center justify-center gap-3 py-4">
            <CircleCheck
              aria-hidden="true"
              className="size-5 shrink-0 text-accent"
            />
            <p className="type-body-sm font-medium text-ink">{tOverview('todoEmpty')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {completeness.recommendations.map((recommendation) => {
              const Icon = recommendationIcons[recommendation.key]

              return (
                <li
                  className="flex items-center gap-4 py-4"
                  key={recommendation.key}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="type-body-sm font-medium text-ink">
                      {tProfile(`component.${recommendation.key}`)}
                    </h3>
                    <p className="mt-1 type-body-sm">
                      {tOverview(
                        `todoDescription.${recommendation.key}`,
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant="secondary">
                      {tOverview('todoRemaining', { count: 1 })}
                    </Badge>
                    <Link
                      className="inline-flex min-h-12 items-center rounded-lg px-3 type-body-sm font-medium text-accent hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/dashboard/brands/${slug}/edit?step=${recommendation.step}`}
                    >
                      {tOverview('todoGoComplete')}
                    </Link>
                  </div>
                </li>
              )
            })}
            {showVerification ? (
              <li className="flex items-center gap-4 py-4">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-5 shrink-0 text-accent"
                />
                <h3 className="min-w-0 flex-1 type-body-sm font-medium text-ink">
                  {tOverview('todoVerification')}
                </h3>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="secondary">
                    {tOverview('todoRemaining', { count: 1 })}
                  </Badge>
                  <Link
                    className="inline-flex min-h-12 items-center rounded-lg px-3 type-body-sm font-medium text-accent hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/dashboard/brands/${slug}/verification`}
                  >
                    {tOverview('todoGoComplete')}
                  </Link>
                </div>
              </li>
            ) : null}
          </ul>
        )}
      </SurfaceCard>
    </section>
  )
}
