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
        <h2 className="type-section-title-large text-balance">{heading}</h2>
        <p className="mt-4 max-w-3xl type-page-subtitle text-pretty">{statement}</p>
        <div className="mt-8 max-w-3xl space-y-6">
          {pillars.map((pillar) => (
            <article key={pillar.heading}>
              <h3 className="type-card-title text-cta">{pillar.heading}</h3>
              <p className="mt-2 type-body-muted text-pretty">{pillar.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
