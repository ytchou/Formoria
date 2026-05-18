import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin | MIT Map",
};

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Admin Dashboard
      </h1>
      <p className="mt-2 text-muted-foreground">
        Manage brands, submissions, and site settings.
      </p>
    </div>
  );
}
