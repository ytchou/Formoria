import { z } from "zod";

type Translator = (key: string) => string;

export function getSignInSchema(t: Translator) {
  return z.object({
    email: z.email(t("validation.emailInvalid")),
    password: z.string().min(1, t("validation.passwordRequired")),
  });
}

export function getSignUpSchema(t: Translator) {
  return z
    .object({
      email: z.email(t("validation.emailInvalid")),
      password: z.string().min(8, t("validation.passwordMinLength")),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}

export function getForgotPasswordSchema(t: Translator) {
  return z.object({
    email: z.email(t("validation.emailInvalid")),
  });
}

export function getResetPasswordSchema(t: Translator) {
  return z
    .object({
      password: z.string().min(8, t("validation.passwordMinLength")),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}

export function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  try {
    // Resolve against a fixed base; reject anything that escapes the base origin.
    // Catches backslash- and control-char-based protocol-relative bypasses that
    // WHATWG URL parsing normalizes (e.g. "/\\evil.com" -> host "evil.com").
    const base = "https://formoria.invalid";
    return new URL(url, base).origin === base;
  } catch {
    return false;
  }
}
