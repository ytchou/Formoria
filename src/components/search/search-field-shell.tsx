import type { ComponentProps, ChangeEventHandler } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchFieldShellProps = {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onClear: () => void;
  inputProps?: Omit<ComponentProps<typeof Input>, "value" | "onChange">;
  busy?: boolean;
  clearLabel: string;
};

export function SearchFieldShell({
  value,
  onChange,
  onClear,
  inputProps,
  busy = false,
  clearLabel,
}: SearchFieldShellProps) {
  return (
    <div className="relative">
      {/* Search icon */}
      {busy ? (
        <Loader2
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin motion-reduce:animate-none text-ink-muted"
          aria-hidden="true"
        />
      ) : (
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      )}

      <Input
        {...inputProps}
        value={value}
        onChange={onChange}
        className={cn("w-full pl-9 pr-8", inputProps?.className)}
      />

      {/* Clear button */}
      {value && (
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-ink-muted hover:bg-transparent hover:text-ink"
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </Button>
      )}
    </div>
  );
}
