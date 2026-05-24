import { cleanupTestData } from './helpers/cleanup';

async function globalTeardown() {
  await cleanupTestData();
}

export default globalTeardown;
