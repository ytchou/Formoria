import { AdminSubNav } from '@/components/admin/admin-sub-nav'

const tabs = [
  { label: '品牌', href: '/admin/catalog/brands' },
  { label: '分類管理', href: '/admin/catalog/taxonomy' },
  { label: '批量匯入', href: '/admin/catalog/import' },
]

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <AdminSubNav tabs={tabs} />
      {children}
    </>
  )
}
