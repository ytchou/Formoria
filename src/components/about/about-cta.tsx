import CtaSection from '@/components/shared/cta-section'

export default function AboutCta() {
  return (
    <CtaSection
      primaryLabel="探索品牌"
      primaryHref="/brands"
      secondaryLabel="提交品牌"
      secondaryHref="/submit"
    />
  )
}
