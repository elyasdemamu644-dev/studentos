import type { Metadata } from "next";
import { RegisterForm } from "@/features/auth/register-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Tutor Walle account.",
};

export default function RegisterPage() {
  return <RegisterForm />;
}