import type { Metadata } from "next";
import { getPendingFlags } from "@/lib/services/moderation";
import { FlaggedTable } from "@/components/admin/flagged-table";

export const metadata: Metadata = {
  title: "Flagged Content | Admin | MIT Map",
};

export default async function FlaggedContentPage() {
  let flags;
  try {
    flags = await getPendingFlags();
  } catch (err) {
    return (
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Flagged Content
        </h1>
        <p className="mt-4 text-destructive">
          Error loading flags: {err instanceof Error ? err.message : "Unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Flagged Content
      </h1>
      <p className="mt-2 text-muted-foreground">
        Review content flagged by the moderation system.
      </p>

      {flags.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No pending flags. All clear!
        </p>
      ) : (
        <div className="mt-8">
          <FlaggedTable flags={flags} />
        </div>
      )}
    </div>
  );
}
