import type { Metadata } from 'next'
import { RootDocument } from '@/components/shared/root-document'
import zhTW from '../../../messages/zh-TW.json'
import { getSiteUrl } from '@/lib/seo/site-url'
import '../globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  robots: { index: false, follow: true },
}

export default function MicrositeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <RootDocument locale="zh-TW" skipToContentLabel={zhTW.common.skipToContent}>
      {children}
    </RootDocument>
  )
}
