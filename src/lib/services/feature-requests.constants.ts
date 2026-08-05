/**
 * Split out of feature-requests.ts so a client component can read the length
 * bounds without importing the service itself.
 *
 * This is not cosmetic. The service is audit-instrumented, so importing any
 * VALUE from it pulls src/lib/audit -> node:async_hooks into whatever bundle
 * does the importing. In a client component that is a hard Turbopack build
 * failure ("the chunking context does not support external modules"), and it
 * violates this ticket's budget: the audit module is server-only with zero
 * client-bundle impact. Type-only imports are erased and stay safe; values
 * belong here.
 *
 * These mirror the database CHECK constraints, which are the real enforcement:
 * `check (char_length(title) between 4 and 80)` and
 * `check (char_length(body) <= 2000)`, so changing one means changing both.
 *
 * FEATURE_REQUEST_BODY_MIN has no CHECK counterpart on purpose: the column
 * stays nullable because legacy rows were submitted before the body became
 * required, so the minimum is enforced app-side only.
 */
export const FEATURE_REQUEST_TITLE_MIN = 4;
export const FEATURE_REQUEST_TITLE_MAX = 80;
export const FEATURE_REQUEST_BODY_MIN = 10;
export const FEATURE_REQUEST_BODY_MAX = 2000;
