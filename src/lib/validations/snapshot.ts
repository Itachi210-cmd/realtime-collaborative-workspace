import { z } from "zod";

export const createVersionSnapshotSchema = z.object({
  label: z
    .string()
    .trim()
    .max(100, { message: "Snapshot label cannot exceed 100 characters." })
    .nullable()
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, { message: "Snapshot description cannot exceed 500 characters." })
    .nullable()
    .optional(),
});

export type CreateVersionSnapshotInput = z.infer<
  typeof createVersionSnapshotSchema
>;

