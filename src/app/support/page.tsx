import type { Metadata } from 'next'
import Script from 'next/script'

export const metadata: Metadata = {
  title: '支持',
  description:
    'Formoria 是一個由社群驅動的開放平台，完全免費。如果這個專案對你有幫助，歡迎請我們喝杯咖啡！',
}

export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-16">
        {/* Hero */}
        <section className="space-y-4">
          <h1 className="font-heading text-[26px] font-bold text-foreground">
            支持 Formoria
          </h1>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            Formoria 是一個由社群驅動的開放原始碼專案，完全免費，沒有廣告，沒有付費牆。所有的功能開發與維護都靠熱情與志願者的時間支撐。
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            如果 Formoria 對你有幫助，或你認同我們推廣台灣品牌的使命，歡迎請我們喝杯咖啡，讓這個專案可以繼續成長。
          </p>
        </section>

        {/* Buy Me a Coffee */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            請我們喝杯咖啡
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7]">
            你的支持是我們繼續前進的動力。每一杯咖啡都代表著對台灣品牌推廣的認同。
          </p>
          <a
            href="https://buymeacoffee.com/ytchou"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
              alt="Buy Me A Coffee"
              width={217}
              height={60}
            />
          </a>
        </section>

        {/* How it helps */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            你的支持用在哪裡？
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                伺服器費用
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                維持平台穩定運行，讓每位使用者都能快速瀏覽台灣品牌目錄。
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                功能開發
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                持續改善平台功能，讓品牌展示與探索體驗更加完善。
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                社群推廣
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                幫助更多人認識台灣製造品牌，擴大平台的影響力與覆蓋範圍。
              </p>
            </div>
          </div>
        </section>
      </div>

      <Script
        src="https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js"
        data-name="BMC-Widget"
        data-id="ytchou"
        data-description="支持 Formoria 繼續成長！"
        data-color="#40DCA5"
        data-position="Right"
        data-x_margin="18"
        data-y_margin="18"
        strategy="lazyOnload"
      />
    </main>
  )
}
