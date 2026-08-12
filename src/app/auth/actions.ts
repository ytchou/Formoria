"use server";

import { runWithAuditContext } from "@/lib/audit/context";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isRelativeUrl,
  getSignInSchema,
  getSignUpSchema,
  getForgotPasswordSchema,
  getResetPasswordSchema,
} from "@/lib/auth/validations";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { resolvePostAuthPath } from "@/lib/auth/owner-landing";
import { enrollInMarketingEmails } from "@/lib/services/marketing-email-consent";
import { getProfile } from "@/lib/services/profiles";
import {
  isAppLocale,
  localizePath,
  LOCALE_COOKIE,
  resolveAuthenticatedLocale,
  type AppLocale,
} from "@/i18n/locale-preference";

export type AuthState = {
  error?: string;
  message?: string;
};

function localeFromForm(formData: FormData, fallback: string): AppLocale {
  const requestedLocale = formData.get("locale");
  if (typeof requestedLocale === "string" && isAppLocale(requestedLocale)) {
    return requestedLocale;
  }
  return isAppLocale(fallback) ? fallback : "zh-TW";
}

async function setLocaleCookie(locale: AppLocale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production" && process.env.PLAYWRIGHT_TEST !== "true",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function signIn(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  return runWithAuditContext({}, async () => {
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      return { error: error.message };
    }

    const requestedLocale = localeFromForm(formData, await getLocale());
    const profile = data.user ? await getProfile(data.user.id) : null;
    const locale = resolveAuthenticatedLocale({
      isNewUser: false,
      profileLocale: profile?.localePreference,
      intendedLocale: requestedLocale,
    });
    await setLocaleCookie(locale);

    const claimToken = formData.get("claimToken") as string | null;
    if (claimToken) {
      redirect(`/auth/callback?claim=${claimToken}`);
    }

    const cookieStore = await cookies();
    const next = formData.get("next");
    let requestedNext = typeof next === "string" && isRelativeUrl(next) ? next : null;
    if (!requestedNext) {
      const cookieNext = cookieStore.get("post_auth_next")?.value;
      if (cookieNext) {
        try {
          const decodedNext = decodeURIComponent(cookieNext);
          requestedNext = isRelativeUrl(decodedNext) ? decodedNext : null;
        } catch {
          requestedNext = null;
        }
      }
    }
    const redirectPath = await resolvePostAuthPath(requestedNext);
    cookieStore.delete("post_auth_next");
    // Password sign-in never passes through /auth/callback, so it has to stamp
    // the login marker itself. GaUserSync reads it and strips it client-side.
    const target = new URL(localizePath(redirectPath, locale), "http://localhost");
    target.searchParams.set("auth_event", "login");
    redirect(`${target.pathname}${target.search}${target.hash}`);
  });
}

export async function signUp(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  return runWithAuditContext({}, async () => {
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
    const locale = localeFromForm(formData, await getLocale());
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
        data: { locale_preference: locale },
      },
    });

    if (error) {
      return { error: error.message };
    }

    if (marketingEmailOptIn && signUpData.user) {
      await enrollInMarketingEmails(createServiceClient(), {
        email: parsed.data.email,
        userId: signUpData.user.id,
        locale,
        source: "account_signup",
        newsletter: true,
        lifecycle: true,
      });
    }

    await setLocaleCookie(locale);

    redirect(
      localizePath(`/auth/sign-in?message=${encodeURIComponent(t("confirmEmail"))}`, locale)
    );
  });
}

export async function signInWithGoogle(
  claimToken?: string,
  next?: string,
  marketingEmailOptIn = false,
  authLocale = "zh-TW",
): Promise<void> {
  return runWithAuditContext({}, async () => {
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
      secure: process.env.NODE_ENV === "production" && process.env.PLAYWRIGHT_TEST !== "true",
      path: "/",
      maxAge: 600,
    };
    const locale = isAppLocale(authLocale) ? authLocale : "zh-TW";
    cookieStore.set("post_auth_locale", locale, intentCookie);
    if (claimToken) {
      cookieStore.set("post_auth_claim", claimToken, intentCookie);
    }
    if (next && isRelativeUrl(next)) {
      cookieStore.set("post_auth_next", next, intentCookie);
    }
    if (marketingEmailOptIn) {
      cookieStore.set("post_auth_marketing_opt_in", "1", intentCookie);
    } else {
      cookieStore.delete("post_auth_marketing_opt_in");
    }
    cookieStore.delete("post_auth_marketing_locale");

    const redirectTo = `${siteUrl}/auth/callback`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error || !data?.url) {
      redirect(localizePath("/auth/sign-in?error=oauth-failed", locale));
    }

    redirect(data.url);
  });
}

export async function resetPassword(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  return runWithAuditContext({}, async () => {
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
  });
}

export async function updatePassword(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  return runWithAuditContext({}, async () => {
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

    redirect(
      localizePath(
        `/auth/sign-in?message=${encodeURIComponent(t("resetPassword.success"))}`,
        await getLocale()
      )
    );
  });
}
