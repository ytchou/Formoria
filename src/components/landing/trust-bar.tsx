interface TrustBarProps {
  brandCount: number
  categoryCount: number
}

export default function TrustBar({ brandCount, categoryCount }: TrustBarProps) {
  return (
    <section className="py-6 text-center font-heading">
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <span>{brandCount} 個品牌</span>
        <span aria-hidden="true">·</span>
        <span>{categoryCount} 個分類</span>
        <span aria-hidden="true">·</span>
        <span>社群共同策展</span>
      </div>
    </section>
  )
}
