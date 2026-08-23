type StatsCalloutProps = {
  stat: string
  label: string
}

export function StatsCallout({ stat, label }: StatsCalloutProps) {
  return (
    <div className="rounded-surface border border-rule bg-surface p-4">
      <div className="type-section tabular-nums">{stat}</div>
      <div className="mt-1 type-body-sm">{label}</div>
    </div>
  )
}
