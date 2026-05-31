import type { Metadata } from 'next'
import AboutHero from '@/components/about/about-hero'
import OriginStory from '@/components/about/origin-story'
import WhatIsMit from '@/components/about/what-is-mit'
import MissionPillars from '@/components/about/mission-pillars'
import StatsBar from '@/components/about/stats-bar'
import BrandShowcase from '@/components/shared/brand-showcase'
import HowItWorks from '@/components/about/how-it-works'
import TeamSection from '@/components/about/team-section'
import AboutCta from '@/components/about/about-cta'
import { getBrandStats, getRandomBrands } from '@/lib/services/brands'

export const revalidate = 3600

export const metadata: Metadata = {
  title: '關於',
  description:
    'Formoria 是一個開放原始碼的台灣品牌目錄，致力於推廣台灣製造品牌，支持小型企業，讓世界看見台灣的美好。',
}

export default async function AboutPage() {
  const [stats, randomBrands] = await Promise.all([
    getBrandStats(),
    getRandomBrands(4),
  ])

  return (
    <main>
      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <AboutHero />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <OriginStory />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <WhatIsMit />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <MissionPillars />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <StatsBar brandCount={stats.brandCount} categoryCount={stats.categoryCount} />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <BrandShowcase
            brands={randomBrands}
            heading="探索品牌"
            linkText="瀏覽全部品牌 →"
            linkHref="/brands"
          />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <HowItWorks />
        </div>
      </div>

      <div className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <TeamSection />
        </div>
      </div>

      <AboutCta />
    </main>
  )
}
