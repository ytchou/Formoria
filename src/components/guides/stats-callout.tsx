type StatsCalloutProps = {
  stat: string
  label: string
}

export function StatsCallout({ stat, label }: StatsCalloutProps) {
  return (
    <div className="rounded-xl bg-stone-100 p-4">
      <div className="text-2xl font-semibold leading-tight text-stone-900">{stat}</div>
      <div className="mt-1 text-sm font-normal leading-6 text-stone-700">{label}</div>
    </div>
  )
}
