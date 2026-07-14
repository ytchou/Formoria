import { redirect } from "next/navigation";

export default function ReviewQueueRedirect(): never {
  redirect("/admin/submissions");
}
