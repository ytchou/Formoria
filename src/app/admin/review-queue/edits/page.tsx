import { redirect } from "next/navigation";

export default function ReviewQueueEditsRedirect(): never {
  redirect("/admin/edits");
}
