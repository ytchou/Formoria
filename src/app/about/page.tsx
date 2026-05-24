import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '關於',
  description:
    'MIT Map 是一個開放原始碼的台灣品牌目錄，致力於推廣台灣製造品牌，支持小型企業，讓世界看見台灣的美好。',
}

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-16">
        {/* Hero / Mission Statement */}
        <section className="space-y-4">
          <h1 className="font-heading text-[26px] font-bold text-foreground">
            關於 MIT Map
          </h1>
          <p className="font-heading text-xl text-gold">
            推廣台灣製造品牌，讓世界看見台灣的美好
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            MIT Map 是一個精心策劃的台灣品牌目錄，致力於讓更多人認識、支持台灣製造的優質品牌。無論你是想探索本土品牌的消費者，還是希望被更多人看見的品牌經營者，這裡都是你的起點。
          </p>
        </section>

        {/* 我們的使命 */}
        <section className="space-y-6 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            我們的使命
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-coffee">
                推廣台灣品牌
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                讓優質的台灣製造品牌被更多人認識與支持。每一個品牌背後，都有一段值得被看見的故事。
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-coffee">
                支持小型企業
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                幫助小型品牌被看見，讓每個用心經營的品牌都有機會發光。規模不是衡量品質的標準。
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-coffee">
                品牌展示平台
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                為品牌提供另一個展示自己、被發現的管道。讓你的品牌出現在正在尋找你的人面前。
              </p>
            </div>
          </div>
        </section>

        {/* 什麼是「台灣製造」？ */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            什麼是「台灣製造」？
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            MIT Map 收錄的台灣製造品牌，涵蓋在台灣設計、生產或創立的品牌。我們看重的不只是產地標籤，更是每個品牌背後的工藝精神與品牌故事。
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            台灣有許多默默深耕的品牌，以扎實的製程、細膩的設計和真誠的理念打造產品。MIT Map 希望成為這些品牌與消費者之間的橋樑，讓品質說話。
          </p>
        </section>

        {/* 品牌如何被收錄？ */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            品牌如何被收錄？
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            任何人都可以提交品牌資料，由 MIT Map 團隊進行審核，確認品牌的真實性與台灣製造的連結後，品牌即會出現在目錄中。我們不收取任何費用，審核以品質與真實性為唯一標準。
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7]">
            如果你知道一個值得被看見的台灣品牌，歡迎{' '}
            <Link href="/submit" className="text-primary hover:underline">
              提交品牌
            </Link>
            。
          </p>
        </section>

        {/* 開放原始碼 */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            開放原始碼
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            MIT Map 是一個開放原始碼專案，歡迎社群一起貢獻、改善這個平台。無論是功能建議、錯誤回報，或是直接提交 Pull Request，都非常歡迎。
          </p>
        </section>

        {/* 聯繫我們 */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            聯繫我們
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7]">
            有任何問題或建議，歡迎來信：{' '}
            <a
              href="mailto:patrick.ytchou@gmail.com"
              className="text-primary hover:underline"
            >
              patrick.ytchou@gmail.com
            </a>
          </p>
        </section>
      </div>
    </main>
  )
}
