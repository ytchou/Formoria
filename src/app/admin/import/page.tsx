import { BulkImportV2 } from '@/components/admin/bulk-import-v2'

export default function AdminImportPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">批量匯入品牌</h1>
      <BulkImportV2 />
    </div>
  )
}
