# Unified health-agent run boundary

## Symptom

Reusable phase workflows made one nightly run appear as several control planes, transferred
intermediate artifacts between jobs, and allowed one failed collector to hide successful work.
Separate quality reporting and repair also produced duplicate notifications and publication paths.

## Cause

- Workflow jobs, rather than health groups, owned setup, delivery, and artifacts.
- Global completion was used for lifecycle reconciliation even though absence is source-specific.
- Human-readable identities and duplicated Link ownership produced unsafe or duplicate queue rows.
- Repair policy was split across automatic and human publishers.

## Prevention

- Use one scheduled/manual job with five named stages and one working directory.
- Let product, runtime, and repository collectors fail independently, then validate all outputs.
- Reconcile absence only for sources whose collectors completed.
- Canonicalize bounded fingerprints before queueing and keep Link findings Link-owned.
- Create one manager-reviewed repair batch and at most one PR; never auto-merge.
- Send one findings report before repair and one standalone final report, then upload one run artifact.

## How to apply

Add a detector to its health group, return validated structured output, extend the run-level schema,
and add a contract test proving that its failure does not stop the other groups. Keep temporary
detector output local and embed only validated, sanitized evidence in `health-run.json`.

For manual workflow inputs, trace the value from `workflow_dispatch` through the exact runtime CLI
boundary and assert that forwarding in the workflow contract test. Declaring an input alone does not
make it available to the queue or repair stages; a missing argument can silently turn a controlled
canary into an ordinary report-only run.

At publication, request the GitHub App permissions the operation requires and stage only the
validated `changedFiles` allowlist. Run artifacts are intentionally local and may be untracked, so a
broad `git add --all` can silently publish evidence and audit files even after patch validation passes.
Authenticate the repair push with the installation token explicitly and restore the original remote
with a shell trap; a successful token-creation action does not prove a later credential helper will
use that token for Git transport.
Treat every external adapter invocation as its own credential boundary: a secret available to an
earlier queue step is not inherited by the later publication step that records the PR transition.

## Bounded queue claims

### Symptom

A one-fingerprint canary selected the correct repair locally but left unrelated production findings
in `claimed` because the queue RPC acquired every eligible row with the same merge policy.

### Cause

The orchestrator's exact finding selection stopped at the database boundary; the RPC accepted only
a merge policy and lease owner, so it could not preserve the selected fingerprint scope.

### Prevention

Pass the exact fingerprint allowlist through every claim interface and require the database query to
match it. Remove policy-wide overloads, skip empty policy buckets, and reject any returned row outside
the requested scope before building a repair batch.

### How to apply

Any operation that selects a bounded repair set must carry that identity set through the final
mutating query. A local filter is not an authorization boundary when the downstream mutation can
select a broader population.

## Sentry evidence continuity

### Symptom

The split Sentry collector produced a valid finding fingerprint, but the queue row had no exact
provider issue ID and nested activity evidence became empty objects after aggregation.

### Cause

Provider metadata was discarded when collection and classification were separated, and the generic
artifact redactor treated normal aggregate nesting as excessive depth. The same canary normalization
also initially ran outside its explicit canary mode. The collection validator then passed the
canonical issue shape back through the raw-provider sanitizer, which silently reset counts, dates,
tags, stack frames, and latest-event identity.

### Prevention

Persist each sanitized issue and provider identity as one paired record before classification, and
keep the redactor deep enough for the validated run schema.
Use a shape-specific, idempotent validator once data has crossed the provider boundary; test that
validating an already-canonical record twice produces the same record.
Derive controlled repair scope only in `canary_fix`, after checking the exact requested fingerprint,
provider identity, marker tag, stack file, severity, and human merge policy.

### How to apply

When a provider workflow has multiple local stages, model identity metadata as part of the stage
contract even if the external classifier does not use it. Aggregation must preserve already-sanitized
evidence, while any synthetic repair scope remains mode-gated and cannot affect ordinary live runs.
