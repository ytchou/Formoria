import { Globe, Heart, Layers } from 'lucide-react'

const pillars = [
  {
    icon: Globe,
    heading: '推廣台灣品牌',
    description:
      '讓優質的台灣製造品牌被更多人認識與支持。每一個品牌背後，都有一段值得被看見的故事。',
  },
  {
    icon: Heart,
    heading: '支持小型企業',
    description:
      '幫助小型品牌被看見，讓每個用心經營的品牌都有機會發光。規模不是衡量品質的標準。',
  },
  {
    icon: Layers,
    heading: '品牌展示平台',
    description:
      '為品牌提供另一個展示自己、被發現的管道。讓你的品牌出現在正在尋找你的人面前。',
  },
]

export default function MissionPillars() {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">我們的使命</h2>
      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3">
        {pillars.map(({ icon: Icon, heading, description }) => (
          <div key={heading} className="rounded-xl bg-card p-6">
            <Icon className="h-6 w-6 text-primary" />
            <h3 className="mt-4 font-heading text-base font-bold">{heading}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
