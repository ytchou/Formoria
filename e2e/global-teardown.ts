import { cleanupTestData } from './helpers/cleanup';
import { validateStagingTarget } from '../src/lib/supabase/project-target';

async function globalTeardown() {
  validateStagingTarget(process.env);
  // Previous runs' orphans, then this run's own rows. The second sweep is a
  // hard integrity gate: a green deployed run must not leave E2E data behind.
  await cleanupTestData();
  const createdSince = process.env.E2E_RUN_STARTED_AT;
  if (!createdSince) {
    throw new Error('[E2E teardown] E2E_RUN_STARTED_AT is missing; refusing to certify cleanup');
  }
  await cleanupTestData({ createdSince });
}

export default globalTeardown;
