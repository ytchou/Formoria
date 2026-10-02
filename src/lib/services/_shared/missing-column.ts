/** Postgres "undefined column". */
export const MISSING_COLUMN_CODE = "42703";
/** PostgREST "could not find the column in the schema cache". */
const POSTGREST_MISSING_COLUMN_CODE = "PGRST204";

/**
 * True when the error says the database predates `column`. Postgres (42703)
 * and PostgREST (PGRST204) both name the column in the message, which
 * separates one missing column from another that shares the code.
 */
export function isMissingColumn(error: unknown, column: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    (code === MISSING_COLUMN_CODE || code === POSTGREST_MISSING_COLUMN_CODE) &&
    new RegExp(`\\b${column}\\b`, "u").test(message)
  );
}
