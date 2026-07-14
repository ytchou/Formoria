import { redirect } from "next/navigation";

export default function CatalogRedirect(): never {
  redirect("/admin/brands");
}
