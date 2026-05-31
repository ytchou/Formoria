interface OriginStoryProps {
  heading: string
  body1: string
  body2: string
  body3: string
  body4: string
}

export default function OriginStory({ heading, body1, body2, body3, body4 }: OriginStoryProps) {
  return (
    <section className="py-12 md:py-16">
      <div className="max-w-2xl">
        <h2 className="font-heading text-xl font-bold">{heading}</h2>
        <div className="mt-6 space-y-4 text-sm leading-[1.8] text-muted-foreground">
          <p>{body1}</p>
          <p>{body2}</p>
          <p>{body3}</p>
          <p>{body4}</p>
        </div>
      </div>
    </section>
  )
}
