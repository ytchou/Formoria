import type { ComponentProps, ChangeEventHandler } from "react";
import { Loader2, Search, X } from "lucide-react";
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
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
      )}

      <Input
        {...inputProps}
        value={value}
        onChange={onChange}
        // Hide the native WebKit clear button; the shell renders its own.
        // pr-11 clears the 44px (size="icon") clear button pinned at right-0.
        className={cn(
          "w-full pl-9 pr-11 [&::-webkit-search-cancel-button]:appearance-none",
          inputProps?.className,
        )}
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
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
