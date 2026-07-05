import { cleanupTestData } from './helpers/cleanup';

async function globalTeardown() {
  try {
    await cleanupTestData();
  } catch (err) {
    console.error('[E2E teardown] cleanup failed — orphaned rows may remain:', err);
    // Do not rethrow — allow runner to exit cleanly
  }
}

export default globalTeardown;
