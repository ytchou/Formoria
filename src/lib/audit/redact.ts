export const DEFAULT_REDACTION_MAX_BYTES = 64 * 1024;
export const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEYS = new Set([
  "secret",
  "token",
  "apikey",
  "authorization",
  "password",
  "cookie",
  "email",
]);

export type RedactOptions = {
  maxBytes?: number;
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function redactedValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redactedValue(entry, seen));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEYS.has(normalizedKey(key))
      ? REDACTED_VALUE
      : redactedValue(entry, seen);
  }
  return result;
}

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value).slice(0, maxBytes);
  return new TextDecoder().decode(bytes);
}

function capSerialized(value: unknown, maxBytes: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;

  const totalBytes = new TextEncoder().encode(serialized).byteLength;
  if (totalBytes <= maxBytes) return value;

  let retainedBytes = Math.max(0, maxBytes);
  let marker = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const droppedBytes = totalBytes - retainedBytes;
    marker = `[truncated: ${droppedBytes} bytes]`;
    retainedBytes = Math.max(0, maxBytes - new TextEncoder().encode(marker).byteLength);
  }

  const droppedBytes = totalBytes - retainedBytes;
  marker = `[truncated: ${droppedBytes} bytes]`;
  const prefix = utf8Prefix(serialized, retainedBytes);
  return `${prefix}${marker}`;
}

export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_REDACTION_MAX_BYTES);
  return capSerialized(redactedValue(value, new WeakSet<object>()), maxBytes);
}
