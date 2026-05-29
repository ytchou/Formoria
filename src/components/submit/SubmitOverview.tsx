import Link from 'next/link';

export default function SubmitOverview() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-heading text-3xl font-bold text-foreground">
        提交你的台灣品牌
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        MIT Map 收錄台灣在地製造與設計品牌，讓更多人發現你的故事。
      </p>
      <ul className="mt-8 space-y-3">
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">1</span>
          <span className="text-sm text-foreground">填寫品牌基本資訊</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">2</span>
          <span className="text-sm text-foreground">上傳品牌照片與產品圖</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">3</span>
          <span className="text-sm text-foreground">提交審核，等待社群通知</span>
        </li>
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">大約 10 分鐘即可完成</p>
      <Link
        href="/auth/sign-in?next=/submit"
        className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
      >
        登入並開始提交
      </Link>
    </main>
  );
}
