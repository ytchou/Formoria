"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/auth/validations";

export type AuthState = {
  error?: string;
  message?: string;
};

export async function signIn(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

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
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const claimToken = formData.get("claimToken") as string | null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://formoria.com";

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

  const t = await getTranslations("auth");
  redirect(`/auth/sign-in?message=${encodeURIComponent(t("confirmEmail"))}`);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
