import CtaSection from '@/components/shared/cta-section'

interface AboutCtaProps {
  primaryLabel: string
  secondaryLabel: string
}

export default function AboutCta({ primaryLabel, secondaryLabel }: AboutCtaProps) {
  return (
    <CtaSection
      primaryLabel={primaryLabel}
      primaryHref="/brands"
      secondaryLabel={secondaryLabel}
      secondaryHref="/submit"
    />
  )
}
