/**
 * Re-export shim over `agents/runtime`.
 *
 * The audited-model-turn implementation moved to the shared agent runtime so
 * every agent gets the same cost, token and attribution handling (DEV-1644 F15).
 * This file stays because `products/graph.ts` imports `invokeAudited` and
 * `AuditBridgeContext` by name; it holds no logic of its own.
 */

export {
  callModel as invokeAudited,
  type AgentAuditContext as AuditBridgeContext,
} from '../agents/runtime'
