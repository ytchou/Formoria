'use client'

import dynamic from 'next/dynamic'

const TaiwanMapInner = dynamic(
  () => import('@/components/stats/TaiwanMap').then((m) => m.TaiwanMap),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-muted" /> },
)

export function TaiwanMapDynamic({ data }: { data: { city: string; count: number }[] }) {
  return <TaiwanMapInner data={data} />
}
