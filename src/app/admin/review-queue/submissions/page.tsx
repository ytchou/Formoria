import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function ReviewQueueSubmissionsRedirect(): never {
  redirect(routes.admin.submissions());
}
