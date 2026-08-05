/** Deliberate copy of SearchCallStatus; this core must not import the service layer. */
export type AuditStatus =
  | "started"
  | "succeeded"
  | "empty"
  | "failed"
  | "malformed"
  | "timeout"
  | "network_error";

export type AuditKind = "external" | "service";

export type AuditContext = {
  correlationId: string | null;
  actor?: string;
  requestId?: string;
};

export type AuditSpec = {
  provider: string;
  operation: string;
  kind: AuditKind;
  spanId?: string;
  causationId?: string;
  attempt?: number;
  retryAttempt?: number;
  meta?: Record<string, unknown>;
};

export type ChatAuditProvider = "openai" | "deepseek";

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type ChatAuditEvent = {
  provider: ChatAuditProvider;
  model: string;
  ok: boolean;
  status: number;
  data: unknown;
  usage?: ChatUsage;
  latencyMs: number;
  request: {
    system: string;
    user: string;
    imageCount: number;
  };
  retryAttempt?: number;
  meta?: Record<string, unknown>;
  error?: string;
};
