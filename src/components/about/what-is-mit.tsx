interface WhatIsMitProps {
  heading: string
  body1: string
  body2: string
}

export default function WhatIsMit({ heading, body1, body2 }: WhatIsMitProps) {
  return (
    <section className="py-12 md:py-16">
      <div className="max-w-2xl">
        <h2 className="font-heading text-xl font-bold">{heading}</h2>
        <div className="mt-6 space-y-4 text-sm leading-[1.8] text-muted-foreground">
          <p>{body1}</p>
          <p>{body2}</p>
        </div>
      </div>
    </section>
  )
}
