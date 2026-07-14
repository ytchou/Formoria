import { redirect } from "next/navigation";

export default function CatalogBrandsRedirect(): never {
  redirect("/admin/brands");
}
