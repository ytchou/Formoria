import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '服務條款',
  description:
    '了解 Formoria 的服務條款，包括內容所有權、資料使用方式、品牌審核流程及免責聲明。',
}

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-16">
        <section className="space-y-4">
          <h1 className="font-heading text-[26px] font-bold text-foreground">
            服務條款
          </h1>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            感謝您使用 Formoria。使用本平台即表示您同意以下條款。請在提交品牌資料前仔細閱讀。
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            最後更新：2026 年 5 月
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            內容所有權
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            您提交至 Formoria 的品牌資料（包括名稱、描述、圖片、連結等）應為您合法擁有或已獲授權使用的內容。提交內容即表示您授予 Formoria 非獨家、免授權費的使用權，用於在本平台展示及推廣台灣品牌。
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            資料使用方式
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            Formoria 蒐集的品牌資料僅用於建立台灣品牌目錄及提供品牌探索功能。我們不會將您的個人資料或品牌資訊出售予第三方。資料使用方式以本條款及相關隱私政策為準。
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            品牌審核流程
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            所有提交的品牌資料須經過人工審核後方可上線。Formoria 保留拒絕或移除任何不符合平台標準之品牌資料的權利，且不承擔因審核結果對提交者造成影響的責任。審核通過不代表 Formoria 對該品牌的背書或認可。
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            免責聲明
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            Formoria 以現狀提供服務，不對平台內容的完整性、準確性或即時性作出保證。對於因使用本平台而產生的任何直接或間接損失，Formoria 不承擔法律責任。
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            條款變更
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            Formoria 保留隨時修改本服務條款的權利。重大變更將於平台公告，持續使用本服務即視為接受更新後的條款。如有任何疑問，請透過聯絡頁面與我們聯繫。
          </p>
        </section>
      </div>
    </main>
  )
}
