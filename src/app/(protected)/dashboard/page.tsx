import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard | MIT Map",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Dashboard
      </h1>
      <p className="mt-2 text-muted-foreground">
        Welcome, {user?.email}
      </p>
    </div>
  );
}
