import { redirect } from "next/navigation";

export default function SignalsFeedbackRedirect(): never {
  redirect("/admin/feedback");
}
