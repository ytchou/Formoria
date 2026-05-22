"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignInFormProps = {
  claimToken?: string;
  claimBrandName?: string;
};

export function SignInForm({ claimToken, claimBrandName }: SignInFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  const signUpHref = claimToken
    ? `/auth/sign-up?claim=${claimToken}`
    : "/auth/sign-up";

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          登入
        </h1>
        <p className="text-sm text-muted-foreground">
          請輸入您的電子郵件和密碼以繼續
        </p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-lg border border-[#E06B3F]/20 bg-[#E06B3F]/5 px-4 py-3 text-sm">
          登入以在 MIT Map 認領 <strong>{claimBrandName}</strong>。
        </div>
      )}

      {message && (
        <div className="rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
          {message}
        </div>
      )}

      {state.error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <form action={action} className="space-y-4">
        {claimToken && (
          <input type="hidden" name="claimToken" value={claimToken} />
        )}

        <div className="space-y-2">
          <Label htmlFor="email">電子郵件</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密碼</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "登入中..." : "登入"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        還沒有帳號？{" "}
        <Link
          href={signUpHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          註冊
        </Link>
      </p>
    </div>
  );
}
