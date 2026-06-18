import { NextRequest, NextResponse } from 'next/server'
import { unsubscribeNewsletter } from '@/lib/services/newsletter'
import { createServiceClient } from '@/lib/supabase/server'

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
}

function htmlResponse(message: string, status: number) {
  return new NextResponse(
    `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter unsubscribe</title>
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

export function extractToken(url: URL): string | null {
  return url.searchParams.get('token')
}

export async function GET(request: NextRequest) {
  const token = extractToken(new URL(request.url))

  if (!token) {
    return htmlResponse('Missing unsubscribe token.', 400)
  }

  const supabase = createServiceClient()
  const result = await unsubscribeNewsletter(supabase, token)

  if (!result.success) {
    return htmlResponse(result.error ?? 'Token not found', 404)
  }

  return htmlResponse('You have been unsubscribed from Formoria newsletter.', 200)
}
