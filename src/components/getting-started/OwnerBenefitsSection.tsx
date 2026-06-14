'use client'

import { Pencil, ShieldCheck, TrendingUp } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { useUser } from '@/lib/auth/use-user'

const benefits = [
  {
    title: 'Claim Your Brand',
    description: 'Verify your ownership and get full edit access to your listing',
    Icon: ShieldCheck,
  },
  {
    title: 'Manage Your Listing',
    description: 'Update your products, links, and descriptions anytime',
    Icon: Pencil,
  },
  {
    title: 'Track Performance',
    description: 'See how visitors discover and interact with your brand',
    Icon: TrendingUp,
  },
]

export function OwnerBenefitsSection() {
  const { user } = useUser()

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {benefits.map(({ title, description, Icon }) => (
          <article key={title} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <Icon className="size-6 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </article>
        ))}
      </div>

      {!user && (
        <Link
          href="/submit"
          className="inline-flex items-center justify-center rounded-lg bg-[var(--cta)] px-5 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          Submit Your Brand
        </Link>
      )}
    </div>
  )
}
