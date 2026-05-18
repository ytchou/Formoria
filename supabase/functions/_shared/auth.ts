export function verifyCronAuth(req: Request): boolean {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false

  const token = authHeader.replace('Bearer ', '')
  const cronSecret = Deno.env.get('CRON_SECRET')

  if (!cronSecret) return false

  return token === cronSecret
}
