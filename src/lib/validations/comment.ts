import { z } from "zod";

export const createCommentSchema = z.object({
  body: z
    .string({ message: "Comment body is required." })
    .trim()
    .min(1, { message: "Comment body cannot be empty." })
    .max(2000, { message: "Comment body cannot exceed 2000 characters." }),
  anchor: z
    .record(z.string(), z.any())
    .refine(
      (val) => {
        try {
          return JSON.stringify(val).length <= 16 * 1024;
        } catch {
          return false;
        }
      },
      { message: "Comment anchor exceeds maximum allowed size (16KB)." }
    )
    .nullable()
    .optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z
  .object({
    body: z
      .string({ message: "Comment body must be a string." })
      .trim()
      .min(1, { message: "Comment body cannot be empty." })
      .max(2000, { message: "Comment body cannot exceed 2000 characters." })
      .optional(),
    resolved: z.boolean({ message: "Resolved must be a boolean." }).optional(),
  })
  .refine(
    (data) => data.body !== undefined || data.resolved !== undefined,
    {
      message: "At least one field ('body' or 'resolved') must be provided to update comment.",
    }
  );

export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
