/**
 * Authorizes an internal machine caller when `x-origin-verify` matches
 * `ORIGIN_SECRET`.
 *
 * The `x-origin-verify` + `ORIGIN_SECRET` pair is the MACHINE-CALLER
 * credential asserting an authorized internal client. It is asserted by
 * pg_cron HTTP jobs and internal clients reaching Railway directly.
 *
 * This is NOT the `CF_ORIGIN_SECRET` edge credential in `src/proxy.ts`, which
 * asserts the Cloudflare edge origin. The two credentials answer different
 * questions and must not be conflated.
 *
 * An unset or blank (`''`) `ORIGIN_SECRET` must deny every request because a
 * bare comparison could authorize every caller (including callers sending no
 * header).
 */
export function isAuthorizedMachineCaller(req: Request): boolean {
  const secret = process.env.ORIGIN_SECRET?.trim();
  // A blank server-side secret must never make every caller authorized.
  return Boolean(secret) && req.headers.get("x-origin-verify") === secret;
}
