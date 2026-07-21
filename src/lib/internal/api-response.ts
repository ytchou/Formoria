export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ code, message }, { status, headers: NO_STORE_HEADERS })
}
