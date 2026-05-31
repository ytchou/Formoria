interface StatsBarProps {
  brandCount: number
  categoryCount: number
  brandUnit: string
  categoryUnit: string
}

export default function StatsBar({ brandCount, categoryCount, brandUnit, categoryUnit }: StatsBarProps) {
  return (
    <section className="py-12 text-center">
      <div className="flex justify-center gap-16">
        <div>
          <div className="font-heading text-3xl font-bold text-primary">{brandCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">{brandUnit}</div>
        </div>
        <div>
          <div className="font-heading text-3xl font-bold text-primary">{categoryCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">{categoryUnit}</div>
        </div>
      </div>
    </section>
  )
}
