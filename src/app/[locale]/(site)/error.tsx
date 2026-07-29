'use client'

import { RouteError } from '@/components/shared/route-error'

export default function Error(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} titleClassName="type-page-title-large" />
}
