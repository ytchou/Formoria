"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type GoogleButtonProps = {
  action: () => void | Promise<void>;
};

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
    >
      <path
        d="M21.805 12.23c0-.728-.065-1.428-.186-2.1H12v3.971h5.5a4.704 4.704 0 0 1-2.04 3.086v2.56h3.295c1.929-1.775 3.05-4.39 3.05-7.517Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.074-.914 6.765-2.472l-3.295-2.56c-.915.613-2.085.976-3.47.976-2.658 0-4.91-1.795-5.715-4.208H2.88v2.64A9.998 9.998 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.285 13.736A5.997 5.997 0 0 1 5.965 12c0-.603.109-1.188.32-1.736v-2.64H2.88A9.998 9.998 0 0 0 2 12c0 1.61.383 3.133 1.06 4.376l3.225-2.64Z"
        fill="#FBBC04"
      />
      <path
        d="M12 6.056c1.5 0 2.845.516 3.905 1.53l2.93-2.93C17.069 2.97 14.755 2 12 2a9.998 9.998 0 0 0-9.12 5.624l3.405 2.64C7.09 7.85 9.342 6.056 12 6.056Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function GoogleButton({ action }: GoogleButtonProps) {
  const t = useTranslations("auth");

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-[#E5E0D8]" />
        </div>
        <div className="relative flex justify-center text-sm text-muted-foreground">
          <span className="bg-background px-3">{t("orDivider")}</span>
        </div>
      </div>

      <form action={action}>
        <Button
          type="submit"
          variant="outline"
          className="w-full"
        >
          <GoogleGlyph />
          {t("continueWithGoogle")}
        </Button>
      </form>
    </div>
  );
}
