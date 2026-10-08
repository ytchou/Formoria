'use client'

import { Bookmark, LockKeyhole } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useSavedBrands } from '@/hooks/use-saved-brands'
import { useSavedProducts } from '@/hooks/use-saved-products'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { usePathname, useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import {
  sessionStorageOrNull,
  takePendingSave,
  writePendingSave,
} from '@/lib/auth/pending-save'
import { useUser } from '@/lib/auth/use-user'
import {
  trackBrandSaved,
  trackBrandUnsaved,
  trackProductSaved,
  trackProductUnsaved,
} from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

const LOADING = Symbol('loading')

type SaveButtonProps = {
  kind: 'brand' | 'product'
  id: string
  /** Brand slug (for brand save analytics) or product key (for product save analytics). */
  slug: string
  variant?: 'overlay' | 'inline'
  /** `inline` only: a square 44px icon button; the label stays in `aria-label`. */
  iconOnly?: boolean
  className?: string
  /** Names the item in the accessible label. Only the `saveBrand` namespace carries the named keys. */
  name?: string
}

export function SaveButton({
  kind,
  id,
  slug,
  variant = 'overlay',
  iconOnly = false,
  className,
  name,
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
  const label = isSaved ? t('unsave') : t('save')
  const iconRef = useRef<SVGSVGElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const userId = user?.id ?? null

  // The button is never disabled while the viewer loads (DEV-1991): a click that
  // lands before the viewer and the saved set are known is queued here and
  // resolved by the effect below once they are.
  const queuedClickRef = useRef(false)
  const readyRef = useRef(false)
  // The user id the previous effect run saw, or LOADING. When the user id has
  // just changed, the saved set in context still belongs to the previous viewer
  // for one commit (the provider has not started its fetch yet), so it cannot
  // be trusted until the provider has loaded for the new id.
  const lastUserIdRef = useRef<string | null | typeof LOADING>(
    userLoading ? LOADING : userId
  )

  function toggleSave(saved: boolean) {
    if (kind === 'brand') {
      if (saved) {
        trackBrandUnsaved(id, slug, variant)
      } else {
        trackBrandSaved(id, slug, variant)
      }
    } else {
      if (saved) {
        trackProductUnsaved(id, slug, variant)
      } else {
        trackProductSaved(id, slug, variant)
      }
    }
    ctx.toggle(id)

    if (!saved && iconRef.current) {
      const el = iconRef.current
      el.classList.remove('animate-spring-pop')
      requestAnimationFrame(() => el.classList.add('animate-spring-pop'))
    }
  }

  function resolveClick() {
    if (!user) {
      setPromptOpen(true)
      return
    }
    toggleSave(isSaved)
  }

  useEffect(() => {
    const previousUserId = lastUserIdRef.current
    lastUserIdRef.current = userLoading ? LOADING : userId

    const savedSetKnown =
      !userLoading && !ctx.loading && previousUserId === userId
    // Signed out needs only the viewer: the click opens the sign-in prompt.
    const ready = !userLoading && (userId === null || savedSetKnown)
    readyRef.current = ready
    if (!ready) return

    if (queuedClickRef.current) {
      queuedClickRef.current = false
      resolveClick()
      return
    }

    // A save asked for before signing in, in this tab, for this exact item.
    if (userId !== null && takePendingSave(sessionStorageOrNull(), kind, id)) {
      if (!isSaved) toggleSave(false)
      toast.success(t('savedToast'))
    }
    // resolveClick/toggleSave read this render's values; the deps are the
    // inputs that decide readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userLoading, ctx.loading, ctx.savedIds])

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (!readyRef.current) {
      queuedClickRef.current = true
      return
    }

    resolveClick()
  }

  function handleSignIn() {
    const search = typeof window === 'undefined' ? '' : window.location.search
    const localizedPath = localizePath(`${pathname}${search}`, locale)
    // The same return-path cookie the auth callback and password sign-in read.
    document.cookie = `post_auth_next=${encodeURIComponent(
      localizedPath
    )}; path=/; max-age=600; SameSite=Lax`
    writePendingSave(sessionStorageOrNull(), kind, id)
    setPromptOpen(false)
    router.push(routes.auth.signIn({ reason: 'save' }))
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="secondary"
        size={variant === 'overlay' || iconOnly ? 'icon' : undefined}
        shape={variant === 'overlay' ? 'pill' : undefined}
        aria-label={
          name
            ? t(isSaved ? 'unsaveNamedAriaLabel' : 'saveNamedAriaLabel', {
                name,
              })
            : t(isSaved ? 'unsaveAriaLabel' : 'saveAriaLabel')
        }
        title={!user ? t('loginToSave') : label}
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
        {variant === 'inline' && !iconOnly && (
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
      <AlertDialog open={promptOpen} onOpenChange={setPromptOpen}>
        <AlertDialogContent
          size="panel"
          finalFocus={buttonRef}
          // Portalled, but React events still bubble to this button's parents
          // (cards and tiles with their own click handlers).
          onClick={(event) => event.stopPropagation()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('signInPrompt')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('signInPromptDismiss')}</AlertDialogCancel>
            <Button type="button" variant="primary" onClick={handleSignIn}>
              {t('signInPromptConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
