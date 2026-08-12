import type { Locator, Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

import { BUDGET, POLL } from '../budgets';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

type SeededRequest = {
  id: string;
  title: string;
};

type SeedOptions = {
  label: string;
  body?: string;
};

const BOARD_PATH = '/feature-requests';
const ADMIN_PATH = '/admin/feature-requests';

// The board reads through a service-role client and the page is rendered per
// request, but a stale ISR/router cache entry can still serve one render behind
// a mutation — every board assertion polls with a reload rather than asserting
// once.
function serviceClient(): AnySupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Rows are seeded through the service client rather than the UI so a single
 * spec can put several requests on the board: the submit action allows only
 * 3 submissions per user per hour, and the UI path is exercised on its own in
 * `signed-in user submits a request`.
 */
async function seedRequest(
  supabase: AnySupabaseClient,
  options: SeedOptions,
): Promise<SeededRequest> {
  const title = `[E2E-TEST] ${options.label} ${stamp()}`;
  const { data, error } = await supabase
    .from('feature_requests')
    .insert({
      title,
      body: options.body ?? null,
      status: 'open',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(
      `Failed to seed feature request "${title}": ${error?.message ?? 'missing row'}`,
    );
  }
  return { id: data.id, title };
}

async function seedVote(
  supabase: AnySupabaseClient,
  requestId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('feature_request_votes')
    .insert({ request_id: requestId, user_id: userId });
  if (error) throw new Error(`Failed to seed vote: ${error.message}`);
}

async function resolveUserId(
  supabase: AnySupabaseClient,
  email: string | undefined,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data?.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error(`E2E user not found: ${email}`);
  return user.id;
}

/**
 * Removes every row this spec created. `feature_requests` is not swept by
 * `global-teardown` (the `[E2E-TEST]` sweep covers brands and submissions only),
 * so each test owns its own cleanup and calls it from a `finally`.
 */
async function cleanupFeatureRequests(
  supabase: AnySupabaseClient,
  ids: string[],
  titles: string[] = [],
): Promise<void> {
  if (ids.length > 0) {
    await supabase.from('feature_request_votes').delete().in('request_id', ids);
    // Clear the merge pointer first: a tombstone still referencing a target we
    // are about to delete would otherwise be orphaned by the FK's SET NULL.
    await supabase
      .from('feature_requests')
      .update({ merged_into_id: null })
      .in('id', ids);
    await supabase.from('feature_requests').delete().in('id', ids);
  }
  for (const title of titles) {
    const { data } = await supabase
      .from('feature_requests')
      .select('id')
      .eq('title', title);
    const extraIds = ((data ?? []) as { id: string }[]).map((row) => row.id);
    if (extraIds.length === 0) continue;
    await supabase
      .from('feature_request_votes')
      .delete()
      .in('request_id', extraIds);
    await supabase.from('feature_requests').delete().in('id', extraIds);
  }
}

async function gotoAndGuard(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  if (response?.status() === 503) {
    test.skip(true, 'PREVIEW_MODE returns 503 for this route in the current env.');
  }
}

function boardRow(page: Page, title: string): Locator {
  return page.getByRole('listitem').filter({ hasText: title });
}

function upvoteButton(page: Page, title: string): Locator {
  return boardRow(page, title).getByRole('button');
}

async function waitForBoardRow(page: Page, title: string): Promise<void> {
  await expect(async () => {
    await page.reload({ timeout: BUDGET.GATED_UI });
    await expect(boardRow(page, title)).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass(POLL.BOARD);
}

async function waitForBoardRowGone(page: Page, title: string): Promise<void> {
  await expect(async () => {
    await page.reload({ timeout: BUDGET.GATED_UI });
    await expect(boardRow(page, title)).toHaveCount(0, { timeout: BUDGET.RENDERED });
  }).toPass(POLL.BOARD);
}

test.describe('Public feature request board', () => {
  test('anonymous visitor reads the board', async ({ anonPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const supabase = serviceClient();
    const created: string[] = [];

    try {
      const request = await seedRequest(supabase, {
        label: 'Read board',
        body: 'Seeded so an anonymous visitor has something to read.',
      });
      created.push(request.id);
      const voterId = await resolveUserId(supabase, process.env.E2E_USER_EMAIL);
      await seedVote(supabase, request.id, voterId);

      await gotoAndGuard(anonPage, BOARD_PATH);
      await expect(
        anonPage.getByRole('heading', { level: 1, name: '功能建議' }),
      ).toBeVisible();
      await waitForBoardRow(anonPage, request.title);

      const row = boardRow(anonPage, request.title);
      await expect(
        row.getByRole('heading', { name: request.title }),
      ).toBeVisible();
      // `open` renders the "待評估" badge — no auth required to see it.
      await expect(row.getByText('待評估', { exact: true })).toBeVisible();
      await expect(upvoteButton(anonPage, request.title)).toHaveText('1');
    } finally {
      await cleanupFeatureRequests(supabase, created);
    }
  });

  test('signed-out visitor upvotes without signing in', async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const supabase = serviceClient();
    const created: string[] = [];

    try {
      const request = await seedRequest(supabase, {
        label: 'Signed-out upvote',
      });
      created.push(request.id);

      await gotoAndGuard(anonPage, BOARD_PATH);
      await waitForBoardRow(anonPage, request.title);

      const button = upvoteButton(anonPage, request.title);
      // Same toggle as the signed-in control: the board takes guest votes, so
      // there is no locked affordance and no sign-in detour.
      await expect(button).toHaveAttribute(
        'aria-label',
        `為「${request.title}」投票`,
      );
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(button).toHaveText('0');
      await expect(button).toBeEnabled({ timeout: BUDGET.GATED_UI });

      await button.click();

      await expect(button).toHaveAttribute('aria-pressed', 'true', {
        timeout: BUDGET.GATED_UI,
      });
      await expect(button).toHaveText('1');
      await expect(anonPage).not.toHaveURL(/\/auth\/sign-in/);
      // The vote is keyed on the signed visitor cookie, so it must survive a
      // reload — an optimistic-only flip would pass every assertion above.
      await anonPage.reload();
      await waitForBoardRow(anonPage, request.title);
      await expect(upvoteButton(anonPage, request.title)).toHaveText('1');
      await expect(upvoteButton(anonPage, request.title)).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: BUDGET.GATED_UI },
      );
    } finally {
      await cleanupFeatureRequests(supabase, created);
    }
  });

  test('signed-in user submits a request', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const supabase = serviceClient();
    // The submit action allows 3 requests per user per hour; this is the only
    // case in the file that spends that budget.
    const title = `[E2E-TEST] Submitted from the dialog ${stamp()}`;

    try {
      await gotoAndGuard(userPage, BOARD_PATH);
      await userPage.getByRole('button', { name: '提出建議' }).click();

      const dialog = userPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('你希望我們做什麼？').fill(title);
      await dialog
        .getByLabel('詳細說明')
        .fill('[E2E-TEST] Details typed through the submit dialog.');
      await dialog.getByRole('button', { name: '送出建議' }).click();

      await expect(
        userPage.getByText('謝謝你，我們已經收到你的建議。'),
      ).toBeVisible({ timeout: BUDGET.GATED_UI });
      await expect(dialog).toBeHidden();

      await waitForBoardRow(userPage, title);
      // A brand-new request starts at zero votes: submitting is not voting.
      await expect(upvoteButton(userPage, title)).toHaveText('0');
    } finally {
      await cleanupFeatureRequests(supabase, [], [title]);
    }
  });

  test('signed-in user upvotes and un-upvotes', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const supabase = serviceClient();
    const created: string[] = [];

    try {
      const request = await seedRequest(supabase, {
        label: 'Vote toggle',
      });
      created.push(request.id);

      await gotoAndGuard(userPage, BOARD_PATH);
      await waitForBoardRow(userPage, request.title);

      const button = upvoteButton(userPage, request.title);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(button).toHaveText('0');
      await expect(button).toBeEnabled({ timeout: BUDGET.GATED_UI });

      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true', {
        timeout: BUDGET.GATED_UI,
      });
      await expect(button).toHaveText('1');
      await expect(button).toHaveAttribute(
        'aria-label',
        `收回對「${request.title}」的投票`,
      );

      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false', {
        timeout: BUDGET.GATED_UI,
      });
      await expect(button).toHaveText('0');
      await expect(button).toHaveAttribute(
        'aria-label',
        `為「${request.title}」投票`,
      );

      // The un-vote must survive a reload: an optimistic-only rollback would
      // pass every assertion above and still leave the vote in the database.
      await expect(async () => {
        await userPage.reload({ timeout: BUDGET.GATED_UI });
        await expect(upvoteButton(userPage, request.title)).toHaveText('0', {
          timeout: BUDGET.RENDERED,
        });
      }).toPass(POLL.BOARD);
    } finally {
      await cleanupFeatureRequests(supabase, created);
    }
  });

  test('admin merges a duplicate', async ({ adminPage, anonPage }) => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase());
    test.skip(
      !adminEmail || !admins.includes(adminEmail.toLowerCase()),
      'Admin E2E tests require E2E_ADMIN_EMAIL to be included in ADMIN_EMAILS',
    );

    test.setTimeout(BUDGET.TEST.CLAIM);
    const supabase = serviceClient();
    const created: string[] = [];

    try {
      const target = await seedRequest(supabase, {
        label: 'Merge target',
      });
      const source = await seedRequest(supabase, {
        label: 'Merge source',
      });
      created.push(target.id, source.id);
      // Only the source carries a vote, so the target's post-merge count is
      // observable proof the vote moved instead of being dropped.
      const voterId = await resolveUserId(supabase, process.env.E2E_USER_EMAIL);
      await seedVote(supabase, source.id, voterId);

      await gotoAndGuard(anonPage, BOARD_PATH);
      await waitForBoardRow(anonPage, source.title);
      await expect(upvoteButton(anonPage, source.title)).toHaveText('1');
      await expect(upvoteButton(anonPage, target.title)).toHaveText('0');

      await gotoAndGuard(adminPage, ADMIN_PATH);
      await expect(
        adminPage.getByRole('heading', { name: /Feature requests|功能許願/i }),
      ).toBeVisible({ timeout: BUDGET.NAVIGATION });

      const mergeLabel = new RegExp(
        `(Merge ${escapeRegExp(source.title)} into|把「${escapeRegExp(source.title)}」併入)`,
      );
      const mergeSelect = adminPage.getByRole('combobox', { name: mergeLabel });
      await expect(mergeSelect).toBeVisible({ timeout: BUDGET.GATED_UI });
      // Scope by the select, not by row text: every row's merge dropdown lists
      // every other request's title as an option, so a text filter matches all.
      const sourceRow = adminPage
        .getByRole('row')
        .filter({ has: mergeSelect })
        .first();

      await mergeSelect.selectOption({ label: target.title });
      await sourceRow.getByRole('button', { name: /^(Merge|合併)$/ }).click();

      await expect(async () => {
        await adminPage.reload({ timeout: BUDGET.GATED_UI });
        await expect(
          adminPage
            .getByRole('row')
            .filter({ hasText: source.title })
            .first()
            .getByText(/Merged|已合併/),
        ).toBeVisible({ timeout: BUDGET.RENDERED });
      }).toPass(POLL.BOARD);

      // The merged source leaves the public board, and the target absorbs the
      // union of both vote sets.
      await gotoAndGuard(anonPage, BOARD_PATH);
      await waitForBoardRowGone(anonPage, source.title);
      await expect(boardRow(anonPage, target.title)).toBeVisible();
      await expect(upvoteButton(anonPage, target.title)).toHaveText('1');
    } finally {
      await cleanupFeatureRequests(supabase, created);
    }
  });
});
