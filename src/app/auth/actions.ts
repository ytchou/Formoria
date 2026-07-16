"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  isRelativeUrl,
  getSignInSchema,
  getSignUpSchema,
  getForgotPasswordSchema,
  getResetPasswordSchema,
} from "@/lib/auth/validations";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { enrollInMarketingEmails } from "@/lib/services/marketing-email-consent";

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
  const marketingEmailOptIn = formData.get("marketingEmailOptIn") === "true";
  const siteUrl = await getRequestOrigin();

  const emailRedirectTo = claimToken
    ? `${siteUrl}/auth/callback?claim=${claimToken}`
    : `${siteUrl}/auth/callback`;

  const supabase = await createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (marketingEmailOptIn && signUpData.user) {
    await enrollInMarketingEmails(createServiceClient(), {
      email: parsed.data.email,
      userId: signUpData.user.id,
      locale: await getLocale(),
      source: "account_signup",
      newsletter: true,
      lifecycle: true,
    });
  }

  redirect(`/auth/sign-in?message=${encodeURIComponent(t("confirmEmail"))}`);
}

export async function signInWithGoogle(
  claimToken?: string,
  next?: string,
  marketingEmailOptIn = false,
  marketingLocale = "zh-TW",
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
  if (marketingEmailOptIn) {
    cookieStore.set("post_auth_marketing_opt_in", "1", intentCookie);
    cookieStore.set(
      "post_auth_marketing_locale",
      marketingLocale === "en" ? "en" : "zh-TW",
      intentCookie,
    );
  } else {
    cookieStore.delete("post_auth_marketing_opt_in");
    cookieStore.delete("post_auth_marketing_locale");
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
  const tAuth = await getTranslations("auth");
  // Wrap to satisfy the plain (key: string) => string Translator contract
  const t = (key: string) => tAuth(key as Parameters<typeof tAuth>[0]);

  const forgotPasswordSchema = getForgotPasswordSchema(t);
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const siteUrl = await getRequestOrigin();
  // Recovery link lands on /auth/callback, which exchanges the code for a
  // session and then redirects to /auth/reset-password.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/auth/reset-password`,
  });

  // Always return the same message, even on error, to prevent email enumeration
  return { message: t("forgotPassword.successMessage") };
}

export async function updatePassword(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const tAuth = await getTranslations("auth");
  // Wrap to satisfy the plain (key: string) => string Translator contract
  const t = (key: string) => tAuth(key as Parameters<typeof tAuth>[0]);

  const resetPasswordSchema = getResetPasswordSchema(t);
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("resetPassword.sessionExpired") };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: error.message };
  }

  redirect(`/auth/sign-in?message=${encodeURIComponent(t("resetPassword.success"))}`);
}
