'use client'

import { type ReactNode } from 'react'
import { useFilterParams } from '@/hooks/use-filter-params'

export function BrandsGridWrapper({ children }: { children: ReactNode }) {
  const { isPending } = useFilterParams()
  return (
    <div
      className={
        isPending
          ? 'pointer-events-none opacity-50 transition-opacity duration-150'
          : 'transition-opacity duration-150'
      }
    >
      {children}
    </div>
  )
}
