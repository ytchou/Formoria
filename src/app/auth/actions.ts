"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  isRelativeUrl,
  getSignInSchema,
  getSignUpSchema,
} from "@/lib/auth/validations";
import { getRequestOrigin } from "@/lib/auth/site-url";

export type AuthState = {
  error?: string;
  message?: string;
};

export async function signIn(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const tAuth = await getTranslations("auth");
  // Wrap to satisfy the plain (key: string) => string Translator contract
  const t = (key: string) => tAuth(key as Parameters<typeof tAuth>[0]);
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const signInSchema = getSignInSchema(t);
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  const claimToken = formData.get("claimToken") as string | null;
  if (claimToken) {
    redirect(`/auth/callback?claim=${claimToken}`);
  }

  const next = formData.get("next") as string | null;
  const isRelativeUrl = next && next.startsWith("/") && !next.startsWith("//");
  redirect(isRelativeUrl ? next : "/dashboard");
}

export async function signUp(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const tAuth = await getTranslations("auth");
  // Wrap to satisfy the plain (key: string) => string Translator contract
  const t = (key: string) => tAuth(key as Parameters<typeof tAuth>[0]);
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const signUpSchema = getSignUpSchema(t);
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const claimToken = formData.get("claimToken") as string | null;
  const siteUrl = await getRequestOrigin();

  const emailRedirectTo = claimToken
    ? `${siteUrl}/auth/callback?claim=${claimToken}`
    : `${siteUrl}/auth/callback`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect(`/auth/sign-in?message=${encodeURIComponent(t("confirmEmail"))}`);
}

export async function signInWithGoogle(
  claimToken?: string,
  next?: string
): Promise<void> {
  const supabase = await createClient();
  const siteUrl = await getRequestOrigin();

  // Carry post-auth intent in short-lived cookies rather than query params on
  // redirectTo: Supabase rejects redirect URLs whose query string isn't covered
  // by the allowlist and silently falls back to the Site URL, stranding the user
  // on the wrong page. Keeping redirectTo bare matches the allowlisted
  // /auth/callback entry; the callback reads these cookies back.
  const cookieStore = await cookies();
  const intentCookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  if (claimToken) {
    cookieStore.set("post_auth_claim", claimToken, intentCookie);
  }
  if (next && isRelativeUrl(next)) {
    cookieStore.set("post_auth_next", next, intentCookie);
  }

  const redirectTo = `${siteUrl}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error || !data?.url) {
    redirect("/auth/sign-in?error=oauth-failed");
  }

  redirect(data.url);
}

export async function signOut(returnTo?: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect(returnTo && isRelativeUrl(returnTo) ? returnTo : "/");
}

export async function resetPassword(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get("email") as string;
  if (!email) return { error: "Please enter your email address" };

  const supabase = await createClient();
  const siteUrl = await getRequestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/reset-password`,
  });

  if (error) return { error: error.message };
  return { message: "Check your email for a password reset link" };
}
