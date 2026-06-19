import { NextRequest, NextResponse } from 'next/server'
import { confirmSubscriber } from '@/lib/services/newsletter'
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
    <title>Newsletter confirmation</title>
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

export function buildConfirmRedirectUrl(origin: string): string {
  return `${origin}/?subscribed=true`
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token = extractToken(url)

  if (!token) {
    return htmlResponse('Invalid link', 400)
  }

  const supabase = createServiceClient()
  const result = await confirmSubscriber(supabase, token)

  if (!result.success) {
    return htmlResponse(
      'Invalid or expired confirmation link. Please re-subscribe to receive a new confirmation email.',
      400
    )
  }

  return NextResponse.redirect(buildConfirmRedirectUrl(url.origin))
}
