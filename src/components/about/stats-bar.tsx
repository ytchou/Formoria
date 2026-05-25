interface StatsBarProps {
  brandCount: number
  categoryCount: number
}

export default function StatsBar({ brandCount, categoryCount }: StatsBarProps) {
  return (
    <section className="py-12 text-center">
      <div className="flex justify-center gap-16">
        <div>
          <div className="font-heading text-3xl font-bold text-primary">{brandCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">個品牌</div>
        </div>
        <div>
          <div className="font-heading text-3xl font-bold text-primary">{categoryCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">個分類</div>
        </div>
      </div>
    </section>
  )
}
