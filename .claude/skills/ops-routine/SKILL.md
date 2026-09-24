# Ops Routine — Delegated Task Execution

You are executing a task delegated by the Formoria ops agent via a Claude Code Routine fire.

## Input

Your input is a JSON object with these fields:

```json
{
  "channel": "C_OPS_CHANNEL_ID",
  "thread_ts": "1234567890.123456",
  "operator": "system:bot or operator@formoria.com",
  "request": "The original Slack message text",
  "description": "What the ops agent wants you to do (human path only)",
  "repair": {
    "agent": "ops-agent",
    "ref": "staging",
    "runId": "uuid",
    "traceUrl": "https://cloud.langfuse.com/trace/...",
    "scope": ["src/lib/some/file.ts"],
    "findings": [{
      "fingerprint": "source:detector:key",
      "title": "Human-readable finding title",
      "severity": "low|medium|high|critical",
      "source": "sentry|pipeline|directory|credential|...",
      "rootCause": "optional root cause description",
      "permalink": "optional link to external issue",
      "evidence": { "...full diagnostic bag from the detector..." }
    }]
  }
}
```

Parse the JSON from your input text. Either `description` or `repair` is present, never both.

If `repair.agent === "e2e-agent"`, follow **Execution — E2E repair path** below instead of the generic repair path. Every other `repair` uses **Execution — Repair path**.

## Execution — E2E repair path (`repair.agent === "e2e-agent"`)

The nightly E2E agent ran the Playwright suite against deployed staging and it went red. Each finding is one failing test or one unexpected skip. `evidence` holds `file`, `project`, `error`, `kind` (`failure` or `unexpected_skip`), and `stagingSha`. The finding `title` is the test title.

### Step 1: Prepare the checkout

Run these in order before you read or change any spec:

```bash
git fetch origin && git checkout origin/staging   # or the fix branch, when you verify
pnpm install --frozen-lockfile
pnpm exec playwright install chromium             # the image's Chromium is too old for this Playwright version
```

### Step 2: Triage each finding

Classify each finding into exactly one category:

- **Flake** — the test passes when you re-run it against staging with the command in Step 4, with no change. Report it as a false positive.
- **Test drift** — the app behaves correctly, but the spec is out of date (selector, visible text, timing, or fixture). Fix the spec.
- **App regression** — the app is wrong on staging. Fix the app code.
- **Env/data** — staging data, seed fixtures, credentials, or an external service is wrong. Do not fix it in code. Create a Linear ticket with the diagnosis.

### Step 3: Fix on one branch

Put all fixes on **one** branch from `origin/staging`. Open **one PR** that targets `staging`.

### Step 4: Verify each fix against staging

Check out the fix branch, then run each failing test from it:

```bash
CI=true BASE_URL=$STAGING_BASE_URL pnpm exec playwright test <evidence.file> --project=<evidence.project> -g "<title>" --reporter=line
```

- Paste the full verification output into the PR description, one block per finding.
- **Test-drift fixes:** the run above must pass. If it fails, the fix is not done.
- **App-regression fixes:** deployed staging does not have the fix yet, so the run cannot pass. Label the finding in the PR description **"proof = post-merge rerun"**, and still paste the output.

### Step 5: Post aggregate summary

Post ONE summary to the Slack thread in the format of **Step 4: Post aggregate summary** of the generic repair path. Count flakes as "False positive". **NEVER @mention the ops bot** in this summary or in any other message.

## Execution — Repair path (`repair` present)

When `repair` is present, you are the investigator and fixer. Process ALL findings as a batch.

### Step 1: Triage all findings

For each finding, quickly classify it into one of four categories:

- **False positive** — the issue no longer exists or was never real. Verify via Supabase reads, code inspection, or `evidence` fields.
- **Code fix** — a real bug with identifiable scope files. Check `scope`, `rootCause`, `permalink`.
- **Data/pipeline issue** — a real problem without a code fix (stale data, failed pipeline, configuration). Run read-only diagnostic queries.
- **Infrastructure/credential** — a real problem with external services (expired tokens, unreachable endpoints). Report with context.

Every severity is worth investigating — do not skip low-priority findings.

### Step 2: Fix code bugs

Group all code-fix findings together. Investigate the `scope` files and `evidence`, then:

1. Write fixes for all fixable code bugs
2. Create **one PR** targeting the `staging` branch with all fixes
3. Include per-finding details in the PR description (what was wrong, what was fixed)

### Step 3: Handle data/pipeline/infrastructure issues

For each real non-code issue:

1. Run read-only diagnostic queries to gather context
2. Create a **Linear ticket** with the fields below
3. Never run write operations or data-modifying scripts

**Linear ticket requirements** (must match the `/create-ticket` skill):

- **Team:** Look up teams with `list_teams` and use the team whose project matches "Formoria"
- **Project:** Look up projects with `list_projects` and attach the "Formoria" project
- **Assignee:** `"me"` (resolves to the current Linear user)
- **Labels:** Use `list_issue_labels` to find the label IDs, then apply:
  - `Bug` — for broken behavior
  - `Infra` — for infrastructure/credential/pipeline issues
  - One scope label: `S` (config fix), `M` (multi-step), or `L` (new subsystem)
- **Priority:** High → `Urgent`, Medium → `High`, Low → `Normal`
- **Title:** Short imperative — e.g. "Fix ORIGIN_SECRET mismatch on health-agent service"
- **Body:** Use the bug template:
  ```
  ## Symptom
  [What is broken — one paragraph]

  ## Location
  [Service, env var, or endpoint affected]

  ## Potential Causes
  - [Root cause from investigation]

  ## Context
  - Source: health-agent finding `<fingerprint>`
  - Evidence: <diagnostic details>

  ## Assessment
  - **Complexity:** Low / Medium / High
  - **Urgency:** Low / Medium / High
  ```

### Step 4: Post aggregate summary

Post ONE summary to the Slack thread via the relay endpoint so it appears as the Formoria Ops bot (not your personal Slack identity):

```bash
curl -s -X POST "https://formoria.com/api/internal/ops-summary" \
  -H "Authorization: Bearer $OPS_ROUTINE_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "<channel from input>",
    "thread_ts": "<thread_ts from input>",
    "text": "Repair Summary: <N> total, <N> fixed, <N> tickets, <N> skipped",
    "blocks": [
      {"type":"header","text":{"type":"plain_text","text":"Repair Summary — YYYY-MM-DD"}},
      {"type":"section","text":{"type":"mrkdwn","text":"*<total> findings triaged*\n✅ False positive: <N>\n🔧 Fixed: <N> → <PR link or \"no code bugs\">\n📋 Tickets: <N> → DEV-1234, DEV-1235\n⏭️ Report-only: <N>"}},
      {"type":"context","elements":[{"type":"mrkdwn","text":"<traceUrl|Langfuse trace> · Run: `<runId>`"}]}
    ]
  }'
```

**Rules:**
- Always use the relay endpoint above — never the Slack connector — for this message.
- Ticket IDs MUST be listed (e.g. `DEV-1844, DEV-1845`) — never leave the Tickets line empty.
- If tickets were grouped by root cause, show: "5 tickets (grouped from 8 findings)".
- The `text` field is the notification fallback — one line with counts, no Block Kit.
- Per-finding details belong in the PR description or ticket body, not in Slack.

## Execution — Human path (`description` present)

When `description` is present, read it to understand the task. Execute the described work using the data sources below.

Post your result to the Slack thread via the relay endpoint (`/api/internal/ops-summary`) with Block Kit blocks (header, investigation summary, action taken, context). Same `curl` pattern as Step 4 above.

## Safety Rules

- **NEVER @mention the ops bot** in your Slack messages. This creates an infinite loop where the bot triggers itself.
- Never write to production DB directly. Create PRs for code changes.
- Never delete data without explicit operator confirmation in the original request.
- Never run destructive operations (`DROP`, `DELETE`, `TRUNCATE`) against production.
- Read-only database queries are safe and encouraged for investigation.

## Data Sources

- **Supabase**: database reads via `SUPABASE_URL` secret
- **GitHub**: code changes via connector (create PRs targeting `staging`)
- **Linear**: ticket creation for unfixed real findings
- **Slack**: post via relay endpoint `https://formoria.com/api/internal/ops-summary` using `OPS_ROUTINE_CALLBACK_TOKEN` — never via the Slack connector (which posts as the user, not the bot)
