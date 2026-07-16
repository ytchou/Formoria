import { requireAdminAction } from '@/lib/auth/require-admin'
import { getRequestOrigin } from '@/lib/auth/site-url'
import { renderRunLogHtml } from '@/lib/runlog'
import { exportJobRunLog } from '@/lib/services/runlog-export'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const auth = await requireAdminAction()
  if ('error' in auth) {
    if (auth.code === 'unauthenticated') {
      const signInUrl = new URL('/auth/sign-in', await getRequestOrigin())
      signInUrl.searchParams.set('next', `/admin/jobs/${id}/runlog`)
      return Response.redirect(signInUrl, 307)
    }

    return new Response(auth.error, { status: 403 })
  }

  const runlog = await exportJobRunLog(id)
  const html = renderRunLogHtml(runlog)
  const download = new URL(request.url).searchParams.get('download') === '1'
  const filenameId = id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(download
        ? { 'content-disposition': `attachment; filename="runlog-${filenameId}.html"` }
        : {}),
    },
  })
}
