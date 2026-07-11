'use client'

import { RouteError } from '@/components/shared/route-error'

export default function GuideDetailError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} descriptionKey="boundary.guideDescription" />
}
