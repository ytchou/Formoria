import { z } from "zod";
import type { CatalogProduct } from "../curated-products-catalog";
import type { PriceRow } from "../llm-pricing";

export const LIMITS = {
  costUsd: 1,
  activeMs: 15 * 60_000,
  sourcePages: 12,
  fetchAttempts: 24,
  modelAttempts: 20,
  revisions: 3,
} as const;
export const OwnerSchema = z.object({
  operatorSlackId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().min(1),
});
export const StartSchema = OwnerSchema.extend({
  requestId: z.string().min(1).max(200),
  brief: z.string().min(1).max(6000),
});
export const CommandSchema = OwnerSchema.extend({
  runId: z.string().regex(/^[a-f0-9]{64}$/),
  command: z.enum(["answer", "status", "resume", "cancel", "retry_delivery"]),
  eventId: z.string().min(1).max(200),
  answer: z.string().max(6000).optional(),
});
export type Owner = z.infer<typeof OwnerSchema>;
export type StartInput = z.infer<typeof StartSchema>;
export type CommandInput = z.infer<typeof CommandSchema>;
export type Budget = {
  costUsd: number;
  reservedUsd: number;
  costUncertain: boolean;
  activeMs: number;
  modelAttempts: number;
  fetchAttempts: number;
  sourceUrls: string[];
  revisions: number;
};
export function emptyBudget(): Budget {
  return {
    costUsd: 0,
    reservedUsd: 0,
    costUncertain: false,
    activeMs: 0,
    modelAttempts: 0,
    fetchAttempts: 0,
    sourceUrls: [],
    revisions: 0,
  };
}
export type Stage =
  | "brief"
  | "overlap"
  | "catalog"
  | "research"
  | "outline"
  | "draft"
  | "review"
  | "done";
export type RunStatus =
  | "running"
  | "awaiting_input"
  | "interrupted"
  | "ready_for_review"
  | "blocked"
  | "budget_exhausted"
  | "cancelled";
export const TERMINAL = new Set<RunStatus>([
  "ready_for_review",
  "blocked",
  "budget_exhausted",
  "cancelled",
]);
export type ContentIntent = {
  slug: string;
  kind: "story" | "trail";
  title: string;
  intent: string;
  draft: boolean;
  content: string;
  hash: string;
};
export type Brief = {
  topic: string;
  audience: string;
  intent: string;
  angle: string;
  requirements: string[];
  question: string | null;
};
export type Candidate = { productId: string; reason: string };
export type Source = {
  id: string;
  productId: string;
  requestedUrl: string;
  finalUrl: string;
  text: string;
  fetchedAt: string;
  status: number;
  mode: "static" | "rendered";
};
export type Fact = {
  id: string;
  productId: string;
  sourceId: string;
  claim: string;
  excerpt: string;
};
export type Claim = { text: string; factIds: string[] };
export type Question = { id: string; stage: Stage; text: string };
export type Run = Owner & {
  version: 1;
  id: string;
  requestId: string;
  input: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  stage: Stage;
  budget: Budget;
  activeStartedAt: string | null;
  price: PriceRow | null;
  question: Question | null;
  answers: Array<{
    questionId: string;
    questionText?: string;
    text: string;
    eventId: string;
  }>;
  processedEvents: string[];
  brief?: Brief;
  content?: ContentIntent[];
  catalog?: CatalogProduct[];
  candidates?: Candidate[];
  exclusions: Array<{ productId: string; reason: string }>;
  /** Individual facts dropped during research; their products may still feature. */
  rejectedFacts?: Array<{ productId: string; claim: string; reason: string }>;
  sources: Source[];
  facts: Fact[];
  outline?: string;
  draft?: string;
  claims: Claim[];
  /** Questions deferred after the brief and overlap stages, kept across revisions. */
  decisions?: string[];
  /** failures block readiness; notes are non-blocking edits for the human editor. */
  review?: { failures: string[]; openDecisions: string[]; notes?: string[] };
  /** The last reviewed draft and its blocking failures, for re-review scoping. */
  reviewed?: { draft: string; failures: string[] };
  error?: string;
  delivery: {
    files: Record<
      string,
      {
        fileId: string;
        uploaded: boolean;
        completed: boolean;
        completionStarted?: boolean;
      }
    >;
    summarySent: boolean;
    error?: string;
  };
};
export function ownsRun(run: Owner, owner: Owner): boolean {
  return (
    run.operatorSlackId === owner.operatorSlackId &&
    run.channelId === owner.channelId &&
    run.threadTs === owner.threadTs
  );
}
