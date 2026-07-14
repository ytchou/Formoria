import { redirect } from "next/navigation";

export default function PendingEditsRedirect(): never {
  redirect("/admin/edits");
}
