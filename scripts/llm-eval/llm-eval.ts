/**
 * @formoria-script
 * purpose: LLM evaluation harness — dataset validation, golden review, experiment runs, prompt management, pairwise comparison
 * class: operator
 * invoke: pnpm llm-eval
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Writes to Langfuse (dataset items, scores, annotation queue items). Zero production DB writes enforced by assertNoNewAuditRows.
 */

console.error('Not implemented yet — full CLI arrives in Task 10.');
process.exit(1);
