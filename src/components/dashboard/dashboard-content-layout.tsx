import type { ReactNode } from 'react'

type DashboardContentLayoutProps = {
  children: ReactNode
  onboarding: ReactNode
  showOnboarding: boolean
}

export function DashboardContentLayout({
  children,
  onboarding,
  showOnboarding,
}: DashboardContentLayoutProps) {
  if (!showOnboarding) {
    return <div className="space-y-6">{children}</div>
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-6">{onboarding}</aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  )
}
