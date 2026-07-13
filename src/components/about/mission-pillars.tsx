interface Pillar {
  heading: string
  body: string
}

interface MissionPillarsProps {
  heading: string
  statement: string
  pillars: [Pillar, Pillar, Pillar]
}

export default function MissionPillars({ heading, statement, pillars }: MissionPillarsProps) {
  return (
    <section className="py-12 md:py-16">
      <div className="page-gutter mx-auto max-w-6xl">
        <p className="type-eyebrow-cta">{heading}</p>
        <h2 className="mt-4 max-w-4xl type-page-title-large text-balance">{statement}</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {pillars.map((pillar) => (
            <article key={pillar.heading} className="max-w-sm">
              <h3 className="type-card-title text-cta">{pillar.heading}</h3>
              <p className="mt-3 type-body-muted text-pretty">{pillar.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
