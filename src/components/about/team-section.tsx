interface TeamSectionProps {
  heading: string
  description: string
}

export default function TeamSection({ heading, description }: TeamSectionProps) {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">{heading}</h2>
      <div className="mt-8 flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card font-heading text-xl font-bold text-foreground">
          PC
        </div>
        <h3 className="mt-4 font-heading text-base font-bold">Patrick Chou</h3>
        <p className="mt-2 max-w-xs text-center text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
