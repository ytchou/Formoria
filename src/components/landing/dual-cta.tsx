import CtaSection from '@/components/shared/cta-section'

export default function DualCta() {
  return (
    <CtaSection
      primaryLabel="探索所有品牌"
      primaryHref="/brands"
      secondaryLabel="提交你的品牌"
      secondaryHref="/submit"
    />
  )
}
