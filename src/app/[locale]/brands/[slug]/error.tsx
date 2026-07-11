'use client'

import { RouteError } from '@/components/shared/route-error'

export default function BrandDetailError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} descriptionKey="boundary.brandDescription" />
}
