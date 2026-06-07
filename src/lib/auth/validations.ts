import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().email("請輸入有效的電子郵件地址"),
  password: z.string().min(1, "請輸入密碼"),
});

export const signUpSchema = z
  .object({
    email: z.string().email("請輸入有效的電子郵件地址"),
    password: z.string().min(8, "密碼至少需要 8 個字元"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "密碼不一致",
    path: ["confirmPassword"],
  });

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
