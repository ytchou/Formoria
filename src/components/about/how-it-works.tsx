import Link from 'next/link'
import { Upload, Search, CheckCircle } from 'lucide-react'

const steps = [
  {
    number: 1,
    icon: Upload,
    label: '提交',
    description: '填寫品牌資料並提交審核申請',
  },
  {
    number: 2,
    icon: Search,
    label: '審核',
    description: 'Formoria 團隊確認品牌真實性與台灣製造連結',
  },
  {
    number: 3,
    icon: CheckCircle,
    label: '上架',
    description: '通過審核後品牌出現在目錄中',
  },
]

export default function HowItWorks() {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">品牌如何上架</h2>
      <div className="mt-8 flex flex-col gap-8 sm:flex-row">
        {steps.map(({ number, icon: Icon, label, description }) => (
          <div key={number} className="flex-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
              {number}
            </div>
            <Icon className="mt-4 h-5 w-5 text-muted-foreground" />
            <h3 className="mt-2 font-heading text-base font-bold">{label}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
      <div className="mt-8">
        <Link href="/submit" className="font-medium text-primary">
          提交品牌 →
        </Link>
      </div>
    </section>
  )
}
