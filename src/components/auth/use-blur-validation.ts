"use client";

import { useCallback, useState } from "react";
import type { z } from "zod";

/**
 * Field errors for an auth form, checked on blur against the SAME schema the
 * server action parses, so the two can never disagree about a rule.
 *
 * Only the fields a caller names are updated, and an empty field never carries
 * an error: `required` and the server action own the "nothing entered" case.
 * Submission is untouched — this only paints errors earlier.
 */
export function useBlurValidation<F extends string>(schema: z.ZodType) {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});

  const validate = useCallback(
    (form: HTMLFormElement | null, fields: readonly F[]) => {
      if (!form) return;

      const formData = new FormData(form);
      const values: Record<string, string> = {};
      formData.forEach((value, key) => {
        if (typeof value === "string") values[key] = value;
      });

      const result = schema.safeParse(values);
      const issues = result.success ? [] : result.error.issues;

      setErrors((previous) => {
        const next = { ...previous };
        for (const field of fields) {
          next[field] = values[field]
            ? issues.find((issue) => issue.path[0] === field)?.message
            : undefined;
        }
        return next;
      });
    },
    [schema],
  );

  return { errors, validate };
}

/** The `aria-describedby` value for an input with a hint and an optional error. */
export function describedBy(...ids: Array<string | false | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}
