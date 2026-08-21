import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function SignalsReportsRedirect(): never {
  redirect(routes.admin.reports());
}
