/**
 * Re-export shim over `agents/runtime`.
 *
 * The audited-model-turn implementation moved to the shared agent runtime so
 * every agent gets the same cost, token and attribution handling (DEV-1644 F15).
 * The file holds no logic of its own. It stays as the historical import name —
 * `invokeAudited` / `AuditBridgeContext` — for callers written against the
 * acquisition agent before the runtime existed; `products/graph.ts` now imports
 * `callModel` from the runtime directly.
 */

export {
  callModel as invokeAudited,
  type AgentAuditContext as AuditBridgeContext,
} from '../agents/runtime'
