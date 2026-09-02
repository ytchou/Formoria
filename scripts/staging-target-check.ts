/**
 * @formoria-script
 * purpose: Proves the loaded credentials name the staging project before a workflow touches it.
 * class: ci-gate
 * invoke: pnpm exec tsx scripts/staging-target-check.ts
 * target: ci
 * safety: read-only
 * owner: engineering
 */
import { validateStagingTarget } from "@/lib/supabase/project-target";

const target = validateStagingTarget();
console.log(
  `Validated staging target ${target.appHostname} against Supabase project ${target.projectRef}`,
);
