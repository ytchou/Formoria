import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function SignalsRedirect(): never {
  redirect(routes.admin.reports());
}
