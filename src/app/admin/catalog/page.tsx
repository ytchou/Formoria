import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function CatalogRedirect(): never {
  redirect(routes.admin.brands());
}
