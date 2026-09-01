'use client'

import { Bookmark, LockKeyhole } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type MouseEvent, useRef } from 'react'

import { useSavedBrands } from '@/hooks/use-saved-brands'
import { useSavedProducts } from '@/hooks/use-saved-products'
import { Button } from '@/components/ui/button'
import { usePathname, useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import {
  trackBrandSaved,
  trackBrandUnsaved,
  trackProductSaved,
  trackProductUnsaved,
} from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

type SaveButtonProps = {
  kind: 'brand' | 'product'
  id: string
  /** Brand slug (for brand save analytics) or product key (for product save analytics). */
  slug: string
  variant?: 'overlay' | 'inline'
  className?: string
}

export function SaveButton({
  kind,
  id,
  slug,
  variant = 'overlay',
  className,
}: SaveButtonProps) {
  const t = useTranslations(kind === 'brand' ? 'saveBrand' : 'saveProduct')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: userLoading } = useUser()
  const brandCtx = useSavedBrands()
  const productCtx = useSavedProducts()
  const ctx = kind === 'brand' ? brandCtx : productCtx
  const isSaved = ctx.savedIds.has(id)
  const isLoading = userLoading || ctx.loading
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

    if (kind === 'brand') {
      if (isSaved) {
        trackBrandUnsaved(id, slug, variant)
      } else {
        trackBrandSaved(id, slug, variant)
      }
    } else {
      if (isSaved) {
        trackProductUnsaved(id, slug, variant)
      } else {
        trackProductSaved(id, slug, variant)
      }
    }
    ctx.toggle(id)

    if (!isSaved && iconRef.current) {
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
          ? 'absolute right-1 top-1 border-transparent bg-transparent hover:bg-transparent'
          : 'shrink-0',
        className
      )}
      onClick={handleClick}
      data-ph-no-autocapture
    >
      {variant === 'overlay' ? (
        <span className="flex size-8 items-center justify-center rounded-full border border-rule bg-surface">
          <Bookmark
            ref={iconRef}
            className="size-4 transition-[fill] duration-200"
            fill={isSaved ? 'currentColor' : 'none'}
            strokeWidth={2}
            aria-hidden
          />
        </span>
      ) : (
        <Bookmark
          ref={iconRef}
          className="h-4 w-4 transition-[fill] duration-200"
          fill={isSaved ? 'currentColor' : 'none'}
          strokeWidth={2}
          aria-hidden
        />
      )}
      {variant === 'inline' && (
        <>
          <span>{label}</span>
          {!userLoading && !user && (
            <LockKeyhole
              data-auth-required-indicator
              className="size-3.5 text-ink-muted"
              aria-hidden="true"
            />
          )}
        </>
      )}
    </Button>
  )
}
