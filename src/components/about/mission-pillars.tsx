interface Pillar {
  heading: string
  body: string
}

interface MissionPillarsProps {
  heading: string
  pillars: [Pillar, Pillar, Pillar]
}

export default function MissionPillars({ heading, pillars }: MissionPillarsProps) {
  return (
    <section className="border-t border-border py-16 md:py-24">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <h2 className="font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {heading}
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {pillars.map((pillar, index) => (
            <div key={pillar.heading} className="border-t border-border pt-5">
              <p className="text-sm font-semibold text-cta">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-4 font-heading text-lg font-bold text-foreground">
                {pillar.heading}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-lg">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
