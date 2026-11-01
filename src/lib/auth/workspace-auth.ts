import { getCurrentSession, SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

export interface WorkspaceAccessResult {
  session: SessionPayload;
  workspace: {
    id: string;
    name: string;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  membership: {
    id: string;
    role: Role;
    joinedAt: Date;
  } | null;
  isOwner: boolean;
}

export type AuthCheckResult =
  | { success: true; data: WorkspaceAccessResult }
  | { success: false; status: number; error: string };

/**
 * Validates authenticated session and verifies workspace membership or ownership.
 * Prevents Insecure Direct Object Reference (IDOR) attacks.
 */
export async function checkWorkspaceAccess(
  workspaceId: string,
  options?: { requireOwner?: boolean }
): Promise<AuthCheckResult> {
  const session = await getCurrentSession();
  if (!session) {
    return { success: false, status: 401, error: "Unauthorized" };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      members: {
        where: { userId: session.userId },
      },
    },
  });

  if (!workspace) {
    return { success: false, status: 404, error: "Workspace not found" };
  }

  const userMembership = workspace.members[0] || null;
  const isOwner = workspace.ownerId === session.userId;

  // If user is neither owner nor listed in workspace_members, access is forbidden
  if (!isOwner && !userMembership) {
    return {
      success: false,
      status: 403,
      error: "Forbidden: You are not a member of this workspace",
    };
  }

  // If owner privileges are required (e.g. rename or delete workspace)
  if (options?.requireOwner && !isOwner) {
    return {
      success: false,
      status: 403,
      error: "Forbidden: Only the workspace owner can perform this action",
    };
  }

  return {
    success: true,
    data: {
      session,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      membership: userMembership
        ? {
            id: userMembership.id,
            role: userMembership.role,
            joinedAt: userMembership.joinedAt,
          }
        : null,
      isOwner,
    },
  };
}

