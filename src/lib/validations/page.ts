import { z } from "zod";

export const createPageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: "Page title cannot be empty." })
    .max(120, { message: "Page title cannot exceed 120 characters." }),
  parentPageId: z.string().trim().nullable().optional(),
});

export const updatePageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: "Page title cannot be empty." })
    .max(120, { message: "Page title cannot exceed 120 characters." }),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

