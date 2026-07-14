import { redirect } from "next/navigation";

export default function ReviewQueueModerationRedirect(): never {
  redirect("/admin/moderation");
}
