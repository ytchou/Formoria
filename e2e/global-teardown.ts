import { cleanupTestData } from './helpers/cleanup';

async function globalTeardown() {
  try {
    // Previous runs' orphans, then this run's own rows. Without the second
    // sweep nothing the run created is ever deleted here — the orphan window is
    // 6h — so a crashed worker left approved [E2E-TEST] brands live in the
    // public catalog until some later run happened to pass the window.
    await cleanupTestData();
    const createdSince = process.env.E2E_RUN_STARTED_AT;
    if (createdSince) {
      await cleanupTestData({ createdSince });
    } else {
      console.warn(
        '[E2E teardown] E2E_RUN_STARTED_AT unset — skipping the run-scoped sweep',
      );
    }
  } catch (err) {
    console.error('[E2E teardown] cleanup failed — orphaned rows may remain:', err);
    // Do not rethrow — allow runner to exit cleanly
  }
}

export default globalTeardown;
