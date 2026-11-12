import { SignJWT, jwtVerify } from "jose";
import { getAuthSecretKey } from "@/lib/env.mjs";

export interface CollabTokenPayload {
  sub: string;
  userName: string;
  pageId: string;
  workspaceId: string;
  role: string;
  purpose: "collaboration";
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
}

export const COLLAB_TOKEN_EXPIRATION_SECONDS = 60;
export const COLLAB_TOKEN_ISSUER = "collab-workspace-auth";
export const COLLAB_TOKEN_AUDIENCE = "collab-workspace-yjs";

/**
 * Creates a short-lived signed JWT token authorizing an OWNER or EDITOR
 * to join the specified page's Yjs collaboration room.
 */
export async function createCollabToken(params: {
  userId: string;
  userName: string;
  pageId: string;
  workspaceId: string;
  role: string;
}): Promise<string> {
  const secretKey = getAuthSecretKey();
  return new SignJWT({
    userName: params.userName,
    pageId: params.pageId,
    workspaceId: params.workspaceId,
    role: params.role,
    purpose: "collaboration",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.userId)
    .setIssuer(COLLAB_TOKEN_ISSUER)
    .setAudience(COLLAB_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${COLLAB_TOKEN_EXPIRATION_SECONDS}s`)
    .sign(secretKey);
}

/**
 * Verifies a short-lived collaboration token and returns the decoded payload,
 * or null if invalid, expired, or tampered with.
 */
export async function verifyCollabToken(
  token: string
): Promise<CollabTokenPayload | null> {
  const secretKey = getAuthSecretKey();
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
      issuer: COLLAB_TOKEN_ISSUER,
      audience: COLLAB_TOKEN_AUDIENCE,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.userName !== "string" ||
      typeof payload.pageId !== "string" ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.role !== "string" ||
      payload.purpose !== "collaboration"
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      userName: payload.userName,
      pageId: payload.pageId,
      workspaceId: payload.workspaceId,
      role: payload.role,
      purpose: "collaboration",
      iss: typeof payload.iss === "string" ? payload.iss : COLLAB_TOKEN_ISSUER,
      aud: typeof payload.aud === "string" ? payload.aud : COLLAB_TOKEN_AUDIENCE,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

