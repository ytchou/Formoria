type StatsCalloutProps = {
  stat: string
  label: string
}

export function StatsCallout({ stat, label }: StatsCalloutProps) {
  return (
    <div className="rounded-xl bg-secondary p-4">
      <div className="type-stat">{stat}</div>
      <div className="mt-1 type-card-description">{label}</div>
    </div>
  )
}
