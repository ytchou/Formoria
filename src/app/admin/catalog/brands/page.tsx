import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function CatalogBrandsRedirect(): never {
  redirect(routes.admin.brands());
}
