import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'
import { buildFaqPageJsonLd } from '@/lib/json-ld'

export const metadata: Metadata = {
  title: '常見問題',
  description:
    '關於 MIT Map 台灣品牌目錄的常見問題解答 — 了解什麼是台灣製造、如何提交品牌、審核流程與品牌認領方式。',
  alternates: { canonical: '/faq' },
}

type FaqItem = {
  question: string
  answer: string
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: '什麼是 MIT Map？',
    answer:
      'MIT Map 是一個開放原始碼的台灣品牌目錄，致力於讓更多人認識與支持台灣製造的優質品牌。無論你是想探索本土品牌的消費者，還是希望被更多人看見的品牌經營者，MIT Map 都是你的起點。',
  },
  {
    question: '「MIT」是什麼意思？',
    answer:
      '「MIT」代表 Made in Taiwan，即台灣製造。MIT Map 收錄的品牌，主要生產製造在台灣，包含在台灣設計、生產或創立的品牌。我們看重的不只是產地標籤，更是每個品牌背後的工藝精神與品牌故事。',
  },
  {
    question: '如何提交品牌到 MIT Map？',
    answer:
      '任何人都可以透過我們的提交表單提交品牌資料。請前往「提交品牌」頁面，填寫品牌基本資訊、官方網站、社群連結等內容，送出後由 MIT Map 團隊進行審核。我們不收取任何費用，審核以品質與真實性為唯一標準。',
  },
  {
    question: '品牌審核需要多久時間？',
    answer:
      '一般情況下，品牌審核約需 7 個工作天。審核期間，我們的團隊會確認品牌的真實性及其與台灣製造的連結。審核通過後，品牌即會出現在目錄中；若資料不完整，我們可能會透過信件與提交者聯繫補件。',
  },
  {
    question: '我是品牌負責人，如何認領或更新品牌頁面？',
    answer:
      '若你是品牌的負責人或官方代表，歡迎透過信件與我們聯繫，告知品牌名稱及你的身份證明方式。我們的團隊會協助你確認身份並進行品牌資料的更新或認領。請來信至頁面底部的聯絡信箱。',
  },
  {
    question: '品牌資料的準確性如何保障？',
    answer:
      'MIT Map 採眾包方式收集品牌資料，並由管理團隊在審核時進行初步核實。如果你發現任何品牌資訊有誤或已過期，歡迎透過聯絡方式告知我們，我們會盡快處理。',
  },
  {
    question: '如何聯繫 MIT Map 團隊？',
    answer:
      '如有任何問題、建議或合作洽詢，歡迎來信：patrick.ytchou@gmail.com。我們的團隊會於收信後盡快回覆，一般工作日內 2–3 個工作天回應。',
  },
]

export default function FaqPage() {
  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqPageJsonLd(FAQ_ITEMS)) }}
      />
      <section className="space-y-4">
        <h1 className="font-heading text-[26px] font-bold text-foreground">常見問題</h1>
        <p className="max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
          以下整理了訪客最常詢問的問題。若仍有疑問，歡迎透過頁面底部的聯絡方式與我們聯繫。
        </p>
      </section>
      <div className="mt-12 divide-y divide-border">
        {FAQ_ITEMS.map((item, i) => (
          <details key={i} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-heading text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-3 max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </main>
  )
}
