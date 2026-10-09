'use client'

import { SaveButton } from '@/components/ui/save-button'

type SaveBrandButtonProps = {
  brandId: string
  slug: string
  variant?: 'overlay' | 'inline'
  iconOnly?: boolean
  className?: string
  /** Brand name, so each card's save control has a distinct accessible name. */
  name?: string
}

export function SaveBrandButton({
  brandId,
  slug,
  variant = 'overlay',
  iconOnly,
  className,
  name,
}: SaveBrandButtonProps) {
  return (
    <SaveButton
      id={brandId}
      slug={slug}
      variant={variant}
      iconOnly={iconOnly}
      className={className}
      name={name}
    />
  )
}
