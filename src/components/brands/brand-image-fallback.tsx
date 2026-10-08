import { cn } from '@/lib/utils'

interface BrandImageFallbackProps {
  name: string
  // Accepted but unused since DEV-1950 removed the category tint; drop it with the callers in a follow-up.
  category?: string | null
  size: 'card' | 'detail'
}

export function BrandImageFallback({ name, size }: BrandImageFallbackProps) {
  const initial = [...name][0]

  return (
    <div
      data-testid="image-fallback"
      className="flex h-full items-center justify-center bg-surface-deep"
    >
      <span
        className={cn(
          size === 'detail' ? 'type-page-title' : 'type-section',
          'text-ink-muted'
        )}
      >
        {initial}
      </span>
    </div>
  )
}
