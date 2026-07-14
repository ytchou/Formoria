import { redirect } from "next/navigation";

export default function SignalsReportsRedirect(): never {
  redirect("/admin/reports");
}
