import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: "Full name must be at least 2 characters." })
    .max(100, { message: "Full name cannot exceed 100 characters." }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Please enter a valid email address." }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long." })
    .max(128, { message: "Password cannot exceed 128 characters." }),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Please enter a valid email address." }),
  password: z
    .string()
    .min(1, { message: "Password is required." }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

