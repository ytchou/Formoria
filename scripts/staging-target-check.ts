import { validateStagingTarget } from "./staging-target";

const target = validateStagingTarget();
console.log(
  `Validated staging target ${target.appHostname} against Supabase project ${target.projectRef}`,
);
