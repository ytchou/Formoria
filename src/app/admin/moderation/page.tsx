import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { getFlaggedContent } from '@/lib/services/moderation'
import type { ModerationTier } from '@/lib/services/moderation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '內容審核 | 管理後台',
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?next=/admin/moderation')
  }

  if (!(await isActingAsAdmin(user.email))) {
    redirect('/')
  }
}

function formatDate(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

function truncateContent(value: string) {
  return value.length > 50 ? `${value.slice(0, 50)}...` : value
}

function TierBadge({ tier }: { tier: ModerationTier }) {
  if (tier === 'tier1') {
    return <Badge variant="destructive">Tier 1</Badge>
  }

  return <Badge variant="outline">Tier 2</Badge>
}

function RiskBadge({ tier }: { tier: ModerationTier }) {
  if (tier === 'tier1') {
    return <Badge className="bg-destructive text-white">高風險</Badge>
  }

  return (
    <Badge className="bg-amber-50 text-amber-700 border border-amber-200">
      中風險
    </Badge>
  )
}

export default async function ModerationPage() {
  await requireAdmin()
  const { items } = await getFlaggedContent({ status: 'pending' })

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        內容審核
      </h1>
      <p className="mt-2 text-warm-caption">
        待審核：{items.length} 件
      </p>

      <div className="mt-8 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand name</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Flagged content</TableHead>
              <TableHead>Risk level</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.brandName}</TableCell>
                <TableCell>{item.fieldName}</TableCell>
                <TableCell>
                  <TierBadge tier={item.tier} />
                </TableCell>
                <TableCell>{item.reason}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {truncateContent(item.flaggedContent)}
                </TableCell>
                <TableCell>
                  <RiskBadge tier={item.tier} />
                </TableCell>
                <TableCell>{formatDate(item.createdAt)}</TableCell>
              </TableRow>
            ))}

            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  無待審內容
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
