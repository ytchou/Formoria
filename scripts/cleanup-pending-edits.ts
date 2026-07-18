import { createServiceClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'

async function main() {
  const supabase = createServiceClient()

  const { data: pendingEdits, error } = await supabase
    .from('pending_brand_edits')
    .select('id, brand_id, submitted_by, brands(name)')
    .eq('status', 'pending')

  if (error) {
    console.error('Failed to fetch pending edits:', error)
    process.exit(1)
  }

  if (!pendingEdits || pendingEdits.length === 0) {
    console.log('No pending edits to clean up.')
    return
  }

  console.log(`Found ${pendingEdits.length} pending edit(s) to clean up.`)

  for (const edit of pendingEdits) {
    const { error: updateError } = await supabase
      .from('pending_brand_edits')
      .update({ status: 'rejected', reviewer_notes: 'Queue removed — process simplified' })
      .eq('id', edit.id)

    if (updateError) {
      console.error(`  Failed to reject edit ${edit.id}:`, updateError)
      continue
    }

    const brandName = Array.isArray(edit.brands)
      ? edit.brands[0]?.name ?? 'Unknown'
      : (edit.brands as { name: string } | null)?.name ?? 'Unknown'

    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', edit.submitted_by)
      .single()

    if (profile?.email) {
      try {
        await sendEmail({
          to: profile.email,
          from: 'Formoria <no-reply@formoria.com>',
          subject: `品牌編輯流程更新：${brandName} — Formoria`,
          html: `
            <p>我們簡化了品牌編輯流程。</p>
            <p>您先前為「${brandName}」提交的編輯已被清除。請重新提交您的編輯，更改將立即生效。</p>
            <p>— Formoria 團隊</p>
          `,
        })
        console.log(`  Notified ${profile.email} for brand "${brandName}"`)
      } catch (emailErr) {
        console.error(`  Email failed for ${profile.email}:`, emailErr)
      }
    }

    console.log(`  Rejected edit ${edit.id} (brand: ${brandName})`)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error('Cleanup script failed:', err)
  process.exit(1)
})
