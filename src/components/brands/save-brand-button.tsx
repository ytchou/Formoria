'use client'

import { SaveButton } from '@/components/ui/save-button'

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
  return (
    <SaveButton
      kind="brand"
      id={brandId}
      slug={slug}
      variant={variant}
      className={className}
    />
  )
}
