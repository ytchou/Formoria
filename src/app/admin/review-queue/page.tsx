import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function ReviewQueueRedirect(): never {
  redirect(routes.admin.submissions());
}
