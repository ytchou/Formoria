'use client'

import { Heart } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { MouseEvent } from 'react'

import { useSavedBrands } from '@/hooks/use-saved-brands'
import { buttonVariants } from '@/components/ui/button'
import { usePathname } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'
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
  const locale = useLocale()
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
      const localizedPath = localizePath(pathname, locale as AppLocale)
      document.cookie = `post_auth_next=${encodeURIComponent(
        localizedPath
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
        variant === 'overlay'
          ? buttonVariants({
              variant: 'secondary',
              size: 'icon',
              shape: 'pill',
              className: 'absolute right-2 top-2 size-8 bg-card shadow-card [&_svg:not([class*=size-])]:size-4',
            })
          : buttonVariants({ variant: 'secondary', className: 'shrink-0' }),
        className
      )}
      onClick={handleClick}
    >
      <Heart
        className="h-4 w-4"
        fill={isSaved ? 'currentColor' : 'none'}
        strokeWidth={2}
        aria-hidden
      />
      {variant === 'inline' && <span>{label}</span>}
    </button>
  )
}
