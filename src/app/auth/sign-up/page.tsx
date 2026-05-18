import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Sign Up | MIT Map",
};

export default function SignUpPage() {
  return <SignUpForm />;
}
