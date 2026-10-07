import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export const loginFormSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const registerFormSchema = z
  .object({
    firstName: z.string().trim().min(2, "First name must be at least 2 characters"),
    lastName: z.string().trim().min(2, "Last name must be at least 2 characters"),
    email: z.string().trim().email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password is too long"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    university: z.string().trim().optional(),
    department: z.string().trim().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export function toRegisterInput(values: RegisterFormValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    password: values.password,
    university: values.university || undefined,
    department: values.department || undefined,
  };
}

export function createLoginSchema() {
  return loginFormSchema;
}

export const loginResolver = zodResolver(loginFormSchema);
export const registerResolver = zodResolver(registerFormSchema);