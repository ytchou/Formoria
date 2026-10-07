'use client'

import { SaveButton } from '@/components/ui/save-button'

type SaveBrandButtonProps = {
  brandId: string
  slug: string
  variant?: 'overlay' | 'inline'
  className?: string
  /** Brand name, so each card's save control has a distinct accessible name. */
  name?: string
}

export function SaveBrandButton({
  brandId,
  slug,
  variant = 'overlay',
  className,
  name,
}: SaveBrandButtonProps) {
  return (
    <SaveButton
      kind="brand"
      id={brandId}
      slug={slug}
      variant={variant}
      className={className}
      name={name}
    />
  )
}
