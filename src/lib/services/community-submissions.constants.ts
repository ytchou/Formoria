/**
 * Split out of community-submissions.ts so a client component can read the cap
 * without importing the service itself.
 *
 * This is not cosmetic. The service is audit-instrumented, so importing any
 * VALUE from it pulls src/lib/audit -> node:async_hooks into whatever bundle
 * does the importing. In a client component that is a hard Turbopack build
 * failure ("the chunking context does not support external modules"), and it
 * violates this ticket's budget: the audit module is server-only with zero
 * client-bundle impact. Type-only imports are erased and stay safe; values
 * belong here.
 */
export const MAX_COMMUNITY_SUBMISSIONS = 500;
