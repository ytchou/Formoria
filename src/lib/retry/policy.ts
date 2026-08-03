export type RetryPolicy = {
  attempts: number;
  baseMs: number;
  factor: number;
  capMs: number;
};

export const RETRY_ATTEMPTS = 3;

export const IN_PROCESS: RetryPolicy = {
  attempts: RETRY_ATTEMPTS,
  baseMs: 500,
  factor: 2,
  capMs: 8_000,
};

export const JOB_REQUEUE: RetryPolicy = {
  attempts: RETRY_ATTEMPTS,
  baseMs: 60_000,
  factor: 2,
  capMs: 900_000,
};
