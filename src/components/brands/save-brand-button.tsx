'use client'

import { SaveButton } from '@/components/ui/save-button'

type SaveBrandButtonProps = {
  brandId: string
  slug: string
  variant?: 'overlay' | 'inline'
  iconOnly?: boolean
  className?: string
}

export function SaveBrandButton({
  brandId,
  slug,
  variant = 'overlay',
  iconOnly,
  className,
}: SaveBrandButtonProps) {
  return (
    <SaveButton
      kind="brand"
      id={brandId}
      slug={slug}
      variant={variant}
      iconOnly={iconOnly}
      className={className}
    />
  )
}
