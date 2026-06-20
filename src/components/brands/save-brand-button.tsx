'use client'

import { Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MouseEvent } from 'react'

import { useSavedBrands } from '@/hooks/use-saved-brands'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useUser } from '@/lib/auth/use-user'
import { cn } from '@/lib/utils'

type SaveBrandButtonProps = {
  brandId: string
  variant?: 'overlay' | 'inline'
  className?: string
}

export function SaveBrandButton({
  brandId,
  variant = 'overlay',
  className,
}: SaveBrandButtonProps) {
  const t = useTranslations('saveBrand')
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: userLoading } = useUser()
  const { savedIds, toggle, loading: savedBrandsLoading } = useSavedBrands()
  const isSaved = savedIds.has(brandId)
  const isLoading = userLoading || savedBrandsLoading
  const label = isSaved ? t('unsave') : t('save')

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (isLoading) {
      return
    }

    if (!user) {
      document.cookie = `post_auth_next=${encodeURIComponent(
        pathname
      )}; path=/; max-age=600; SameSite=Lax`
      router.push('/auth/sign-in')
      return
    }

    toggle(brandId)
  }

  return (
    <button
      type="button"
      aria-label={isSaved ? t('unsaveAriaLabel') : t('saveAriaLabel')}
      title={!user ? t('loginToSave') : label}
      disabled={isLoading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'overlay'
          ? 'absolute right-2 top-2 h-8 w-8 rounded-full border border-border bg-white shadow-sm'
          : 'h-11 gap-1.5 rounded-xl bg-secondary px-3 text-sm font-medium hover:bg-secondary/80',
        className
      )}
      onClick={handleClick}
    >
      <Heart
        className={variant === 'overlay' ? 'h-4 w-4' : 'h-4 w-4'}
        fill={isSaved ? 'currentColor' : 'none'}
        strokeWidth={2}
        aria-hidden
      />
      {variant === 'inline' && <span>{label}</span>}
    </button>
  )
}
