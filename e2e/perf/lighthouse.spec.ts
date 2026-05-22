import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CATEGORY_SLUG = process.env.E2E_CATEGORY_SLUG ?? 'fashion';

const TARGETS = [
  { url: '/', name: 'homepage', lcp: 2000, cls: 0.1 },
  { url: `/categories/${CATEGORY_SLUG}`, name: 'category', lcp: 1000, cls: 0.1 },
  { url: '/brands', name: 'directory', lcp: 2000, cls: 0.1 },
];

async function runLighthouse(url: string): Promise<{ lcp: number; cls: number; fcp: number }> {
  const outputPath = path.join('/tmp', `lh-${Date.now()}.json`);
  execSync(
    `npx lighthouse ${url} --output=json --output-path=${outputPath} --quiet --chrome-flags="--headless --no-sandbox"`,
    { timeout: 60_000 }
  );
  const report = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  const lcp = report.audits['largest-contentful-paint']?.numericValue ?? 99999;
  const cls = report.audits['cumulative-layout-shift']?.numericValue ?? 1;
  const fcp = report.audits['first-contentful-paint']?.numericValue ?? 99999;
  fs.unlinkSync(outputPath);
  return { lcp, cls, fcp };
}

test.describe('Lighthouse perf audits', () => {
  for (const target of TARGETS) {
    test(`${target.name}: LCP < ${target.lcp}ms, CLS < ${target.cls}`, async () => {
      const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
      const { lcp, cls } = await runLighthouse(`${baseURL}${target.url}`);
      console.log(`${target.name}: LCP=${Math.round(lcp)}ms, CLS=${cls.toFixed(3)}`);
      expect(lcp, `${target.name} LCP`).toBeLessThan(target.lcp);
      expect(cls, `${target.name} CLS`).toBeLessThan(target.cls);
    });
  }

  test('brand detail: LCP < 3000ms, CLS < 0.1', async () => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
    // First request to warm ISR cache, second request to measure
    await runLighthouse(`${baseURL}/`); // warm up
    // Get a real brand slug from environment or use a known seed slug
    const slug = process.env.E2E_BRAND_SLUG ?? 'test-brand';
    const { lcp, cls } = await runLighthouse(`${baseURL}/${slug}`);
    console.log(`brand-detail: LCP=${Math.round(lcp)}ms, CLS=${cls.toFixed(3)}`);
    // Local dev server does not have ISR/CDN warmth; production target is < 500ms.
    // Use 3000ms threshold for local dev — tighten when running against staging/prod.
    expect(lcp, 'Brand detail LCP').toBeLessThan(3000);
    expect(cls, 'Brand detail CLS').toBeLessThan(0.1);
  });
});
