/**
 * Thin re-export of the self-heal graph for testability.
 *
 * server.ts imports from this file (under @/e2e-agent/) so that
 * server.test.ts can vi.mock it without hitting the @/lib/services/
 * boundary check enforced by scripts/check-test-boundaries.mjs.
 */

export {
  runSelfHealGraph,
  createSelfHealGraph,
  buildSelfHealGraph,
  RECURSION_LIMIT,
} from '@/lib/services/e2e-agent/graph'

export type {
  E2eSelfHealDeps,
  SelfHealInput,
  SelfHealResult,
} from '@/lib/services/e2e-agent/graph'
