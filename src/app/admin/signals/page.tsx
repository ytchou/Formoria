import { redirect } from "next/navigation";

export default function SignalsRedirect(): never {
  redirect("/admin/reports");
}
