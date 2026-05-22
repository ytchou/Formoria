"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignUpFormProps = {
  claimToken?: string;
  claimBrandName?: string;
};

export function SignUpForm({ claimToken, claimBrandName }: SignUpFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const signInHref = claimToken
    ? `/auth/sign-in?claim=${claimToken}`
    : "/auth/sign-in";

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          建立帳號
        </h1>
        <p className="text-sm text-muted-foreground">
          填寫您的資料以開始使用
        </p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-lg border border-[#E06B3F]/20 bg-[#E06B3F]/5 px-4 py-3 text-sm">
          您已受邀在 MIT Map 認領 <strong>{claimBrandName}</strong>。
          建立帳號以管理您的品牌頁面。
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
            defaultValue={email}
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
            placeholder="至少 8 個字元"
            required
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">確認密碼</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "建立中..." : "建立帳號"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        已有帳號？{" "}
        <Link
          href={signInHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          登入
        </Link>
      </p>
    </div>
  );
}
