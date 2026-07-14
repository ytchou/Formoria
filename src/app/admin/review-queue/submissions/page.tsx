import { redirect } from "next/navigation";

export default function ReviewQueueSubmissionsRedirect(): never {
  redirect("/admin/submissions");
}
