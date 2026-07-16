import { NextRequest } from 'next/server'
import { unsubscribeByToken } from '@/lib/services/email-lifecycle'
import { createServiceClient } from '@/lib/supabase/server'

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
    'You have been unsubscribed from Formoria lifecycle emails. Claim and verification emails will continue.',
    200
  )
}

export const GET = unsubscribe
export const POST = unsubscribe
