import { z } from "zod";

export const DEFAULT_PAGE_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

const MAX_DOCUMENT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB safety limit

export const createPageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: "Page title cannot be empty." })
    .max(120, { message: "Page title cannot exceed 120 characters." }),
  parentPageId: z.string().trim().nullable().optional(),
  content: z
    .record(z.string(), z.any())
    .refine(
      (val) => {
        if (!val || typeof val !== "object" || Array.isArray(val)) return false;
        if (val.type !== "doc") return false;
        try {
          return JSON.stringify(val).length <= MAX_DOCUMENT_SIZE_BYTES;
        } catch {
          return false;
        }
      },
      { message: "Invalid document structure or content exceeds 2MB limit." }
    )
    .optional(),
});

export const updatePageSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: "Page title cannot be empty." })
      .max(120, { message: "Page title cannot exceed 120 characters." })
      .optional(),
    content: z
      .record(z.string(), z.any())
      .refine(
        (val) => {
          if (!val || typeof val !== "object" || Array.isArray(val)) return false;
          if (val.type !== "doc") return false;
          try {
            return JSON.stringify(val).length <= MAX_DOCUMENT_SIZE_BYTES;
          } catch {
            return false;
          }
        },
        { message: "Invalid document structure or content exceeds 2MB limit." }
      )
      .optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.content !== undefined,
    { message: "At least one of 'title' or 'content' must be provided for update." }
  );

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
