export default function TeamSection() {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">團隊</h2>
      <div className="mt-8 flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card font-heading text-xl font-bold text-foreground">
          PC
        </div>
        <h3 className="mt-4 font-heading text-base font-bold">Patrick Chou</h3>
        <p className="mt-2 max-w-xs text-center text-sm text-muted-foreground">
          一個相信台灣品牌值得被看見的普通台灣人
        </p>
      </div>
    </section>
  )
}
