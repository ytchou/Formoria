import { withAuditScope } from '@/lib/audit/scope'
import { NextRequest } from 'next/server'
import { unsubscribeByToken } from '@/lib/services/email-lifecycle'
import { createServiceClient } from '@/lib/supabase/service'

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
}

function htmlResponse(message: string, status: number) {
  return new Response(
    `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Email unsubscribe</title>
  </head>
  <body>
    <main>
      <p>${message}</p>
    </main>
  </body>
</html>`,
    {
      status,
      headers: htmlHeaders,
    }
  )
}

async function unsubscribe(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return htmlResponse('Missing unsubscribe token.', 400)
  }

  const supabase = createServiceClient()
  const result = await unsubscribeByToken(supabase, token)

  if (!result.success) {
    return htmlResponse('Token not found', 404)
  }

  return htmlResponse(
    'You have been unsubscribed from Formoria brand-owner emails. The Formoria newsletter is managed separately — turn it off in your account settings or through the unsubscribe link in the newsletter itself.',
    200
  )
}

export const GET = withAuditScope(unsubscribe)
export const POST = withAuditScope(unsubscribe)
