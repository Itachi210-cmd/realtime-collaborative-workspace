import bcrypt from "bcryptjs";

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Hashes a plaintext password using bcryptjs with cost factor 10.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

