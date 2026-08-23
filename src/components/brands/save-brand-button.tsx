'use client'

import { Bookmark, LockKeyhole } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type MouseEvent, useRef } from 'react'

import { useSavedBrands } from '@/hooks/use-saved-brands'
import { Button } from '@/components/ui/button'
import { usePathname, useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import { trackBrandSaved, trackBrandUnsaved } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

type SaveBrandButtonProps = {
  brandId: string
  slug: string
  variant?: 'overlay' | 'inline'
  className?: string
}

export function SaveBrandButton({
  brandId,
  slug,
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
  const iconRef = useRef<SVGSVGElement>(null)

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (isLoading) {
      return
    }

    if (!user) {
      const localizedPath = localizePath(pathname, locale)
      document.cookie = `post_auth_next=${encodeURIComponent(
        localizedPath
      )}; path=/; max-age=600; SameSite=Lax`
      router.push(routes.auth.signIn())
      return
    }

    const willSave = !isSaved
    if (isSaved) {
      trackBrandUnsaved(brandId, slug, variant)
    } else {
      trackBrandSaved(brandId, slug, variant)
    }
    toggle(brandId)

    if (willSave && iconRef.current) {
      const el = iconRef.current
      el.classList.remove('animate-spring-pop')
      requestAnimationFrame(() => el.classList.add('animate-spring-pop'))
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={variant === 'overlay' ? 'icon' : undefined}
      shape={variant === 'overlay' ? 'pill' : undefined}
      aria-label={isSaved ? t('unsaveAriaLabel') : t('saveAriaLabel')}
      title={!user ? t('loginToSave') : label}
      disabled={isLoading}
      className={cn(
        variant === 'overlay'
          ? // The pill stays 32px so the card art is unchanged; the
            // transparent ::before expands the tap area to 44x44.
            "absolute right-2 top-2 size-8 bg-card shadow-card before:absolute before:-inset-1.5 before:content-[''] [&_svg:not([class*=size-])]:size-4"
          : 'shrink-0',
        className
      )}
      onClick={handleClick}
      data-ph-no-autocapture
    >
      <Bookmark
        ref={iconRef}
        className="h-4 w-4 transition-[fill] duration-200"
        fill={isSaved ? 'currentColor' : 'none'}
        strokeWidth={2}
        aria-hidden
      />
      {variant === 'inline' && (
        <>
          <span>{label}</span>
          {!userLoading && !user && (
            <LockKeyhole
              data-auth-required-indicator
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </>
      )}
    </Button>
  )
}
