import type { Metadata } from "next";
import { getPendingFlags } from "@/lib/services/moderation";
import { reviewFlagAction, revertFlagAction } from "../actions";
import { Button } from "@/components/ui/button";

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
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs font-medium uppercase text-muted-foreground">
                <th className="pb-3 pr-4">Brand</th>
                <th className="pb-3 pr-4">Field</th>
                <th className="pb-3 pr-4">Content</th>
                <th className="pb-3 pr-4">Reason</th>
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.id} className="border-b">
                  <td className="py-3 pr-4 font-medium">
                    {flag.brandName ?? "Unknown"}
                  </td>
                  <td className="py-3 pr-4">{flag.fieldName}</td>
                  <td className="max-w-xs py-3 pr-4">
                    {flag.previousContent !== null ? (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="mb-1 block font-medium text-muted-foreground">Before</span>
                          <span className="text-muted-foreground">{flag.previousContent}</span>
                        </div>
                        <div>
                          <span className="mb-1 block font-medium">After</span>
                          <span>{flag.flaggedContent}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="truncate text-muted-foreground">{flag.flaggedContent}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">{flag.flagReason}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {new Date(flag.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <form
                        action={async () => {
                          "use server";
                          await reviewFlagAction(flag.id, "reviewed");
                        }}
                      >
                        <Button size="sm" variant="outline">
                          Review
                        </Button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await reviewFlagAction(flag.id, "dismissed");
                        }}
                      >
                        <Button size="sm" variant="ghost">
                          Dismiss
                        </Button>
                      </form>
                      {flag.previousContent !== null && (
                        <form
                          action={async () => {
                            "use server";
                            const result = await revertFlagAction(flag.id);
                            if ('error' in result && result.error === 'stale') {
                              // stale revert — content has changed since flag was created
                              console.warn('[admin:revert] stale revert attempted for flag', flag.id);
                            }
                          }}
                        >
                          <Button size="sm" variant="destructive">
                            Revert
                          </Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
