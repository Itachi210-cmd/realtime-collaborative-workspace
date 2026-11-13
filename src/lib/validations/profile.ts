import { z } from "zod";

/**
 * Validation schema for updating user profile.
 * - Name is required (2-60 characters).
 * - Password change is optional.
 * - If changing password:
 *   - Current password is required.
 *   - New password must be at least 8 characters (max 128).
 *   - Requires at least one letter and one number or symbol.
 *   - New password cannot be identical to current password.
 *   - If confirmNewPassword is provided, it must match newPassword.
 * - Never accepts password hashes from the client.
 */
export const updateProfileSchema = z
  .object({
    name: z
      .string({ message: "Full name is required." })
      .trim()
      .min(2, { message: "Full name must be at least 2 characters." })
      .max(60, { message: "Full name cannot exceed 60 characters." }),
    currentPassword: z.string().optional(),
    newPassword: z.string().optional(),
    confirmNewPassword: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasCurrentPassword = Boolean(
      data.currentPassword && data.currentPassword.trim().length > 0
    );
    const hasNewPassword = Boolean(
      data.newPassword && data.newPassword.trim().length > 0
    );
    const hasConfirmPassword = Boolean(
      data.confirmNewPassword && data.confirmNewPassword.trim().length > 0
    );

    // If any password field is provided, password change validation is triggered
    if (hasCurrentPassword || hasNewPassword || hasConfirmPassword) {
      if (!hasCurrentPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["currentPassword"],
          message: "Current password is required to change your password.",
        });
      }

      if (!hasNewPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newPassword"],
          message: "New password is required.",
        });
      } else {
        if (data.newPassword!.length < 8) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["newPassword"],
            message: "New password must be at least 8 characters long.",
          });
        }
        if (data.newPassword!.length > 128) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["newPassword"],
            message: "New password cannot exceed 128 characters.",
          });
        }
        const hasLetter = /[a-zA-Z]/.test(data.newPassword!);
        const hasNumberOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(
          data.newPassword!
        );
        if (!hasLetter || !hasNumberOrSymbol) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["newPassword"],
            message:
              "New password must contain at least one letter and one number or symbol.",
          });
        }
      }

      if (
        hasCurrentPassword &&
        hasNewPassword &&
        data.currentPassword === data.newPassword
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newPassword"],
          message: "New password must be different from current password.",
        });
      }

      if (hasNewPassword && data.confirmNewPassword !== undefined) {
        if (data.newPassword !== data.confirmNewPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confirmNewPassword"],
            message: "New passwords do not match.",
          });
        }
      }
    }
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
