interface AboutHeroProps {
  title: string
  subtitle: string
}

export default function AboutHero({ title, subtitle }: AboutHeroProps) {
  return (
    <section className="bg-background py-16 md:py-24">
      <div className="max-w-2xl">
        <h1 className="font-heading text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
      </div>
    </section>
  )
}
