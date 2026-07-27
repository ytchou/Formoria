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
