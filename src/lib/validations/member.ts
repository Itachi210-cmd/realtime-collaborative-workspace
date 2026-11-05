import { z } from "zod";
import { Role } from "@prisma/client";

export const addMemberSchema = z.object({
  email: z
    .string({ message: "Email is required." })
    .trim()
    .email({ message: "Invalid email address." })
    .toLowerCase(),
  role: z.enum([Role.EDITOR, Role.COMMENTER, Role.VIEWER], {
    message: "Role must be EDITOR, COMMENTER, or VIEWER.",
  }),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum([Role.EDITOR, Role.COMMENTER, Role.VIEWER], {
    message: "Role must be EDITOR, COMMENTER, or VIEWER.",
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

