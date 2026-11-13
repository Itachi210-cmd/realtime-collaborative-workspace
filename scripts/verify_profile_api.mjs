/**
 * Verification Suite: Profile Update API & Account Settings
 *
 * Verifies that:
 * 1. Unauthenticated PATCH request is rejected with 401 Unauthorized.
 * 2. Valid name update succeeds with 200 OK.
 * 3. Invalid short name (< 2 chars) is rejected with 400 Bad Request.
 * 4. Missing current password is rejected when changing password with 400 Bad Request.
 * 5. Incorrect current password is rejected with 400 Bad Request.
 * 6. Valid password change succeeds and updates the bcrypt hash.
 * 7. Password hashes are never exposed in any response.
 * 8. CSRF protection works (blocks cross-site and untrusted origins).
 * 9. Existing GET /api/auth/me remains functional for authenticated and unauthenticated sessions.
 * 10. Zod schema validation rules (min/max length, complexity, identical passwords).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

// Ensure test environment secrets are initialized before importing auth modules
process.env.AUTH_SECRET =
  process.env.AUTH_SECRET || crypto.randomBytes(32).toString('base64url');
process.env.INTERNAL_RPC_SECRET =
  process.env.INTERNAL_RPC_SECRET || crypto.randomBytes(32).toString('hex');

import { createJiti } from 'jiti';

const rootDir = process.cwd();
const jiti = createJiti(rootDir, {
  alias: {
    '@': path.resolve(rootDir, 'src'),
  },
});

// Import NextRequest, route handlers and auth utilities via jiti
const { NextRequest } = await jiti.import('next/server');
const { GET, PATCH } = await jiti.import('./src/app/api/auth/me/route.ts');
const { createSessionToken, SESSION_COOKIE_NAME } = await jiti.import('./src/lib/auth/session.ts');
const { hashPassword, verifyPassword } = await jiti.import('./src/lib/auth/password.ts');
const { prisma } = await jiti.import('./src/lib/prisma.ts');
const { updateProfileSchema } = await jiti.import('./src/lib/validations/profile.ts');

async function run() {
  console.log('=== Running Profile Update API & Validation Verification Suite ===\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // --- Part 1: Schema Unit Tests ---
  console.log('--- Testing Zod Validation Schema ---');

  await test('Schema accepts valid name without password change', () => {
    const res = updateProfileSchema.safeParse({ name: 'Alex Johnson' });
    assert.equal(res.success, true);
    assert.equal(res.data.name, 'Alex Johnson');
  });

  await test('Schema rejects name with fewer than 2 characters', () => {
    const res = updateProfileSchema.safeParse({ name: 'A' });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.name);
  });

  await test('Schema rejects name exceeding 60 characters', () => {
    const res = updateProfileSchema.safeParse({ name: 'A'.repeat(61) });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.name);
  });

  await test('Schema rejects password change missing currentPassword', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      newPassword: 'ValidPass123!',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.currentPassword);
  });

  await test('Schema rejects identical current and new passwords', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      currentPassword: 'SamePassword123!',
      newPassword: 'SamePassword123!',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.newPassword);
  });

  await test('Schema rejects new password with fewer than 8 characters', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      currentPassword: 'OldPassword123!',
      newPassword: 'Short1!',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.newPassword);
  });

  await test('Schema rejects new password lacking numbers or symbols', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      currentPassword: 'OldPassword123!',
      newPassword: 'OnlyLettersHere',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.newPassword);
  });

  await test('Schema rejects mismatched confirmNewPassword', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
      confirmNewPassword: 'DifferentPassword123!',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.flatten().fieldErrors.confirmNewPassword);
  });

  await test('Schema strips arbitrary client properties like passwordHash or email', () => {
    const res = updateProfileSchema.safeParse({
      name: 'Alex Johnson',
      email: 'attacker@evil.com',
      passwordHash: '$2a$10$injectedFakeHash',
    });
    assert.equal(res.success, true);
    assert.equal(res.data.email, undefined);
    assert.equal(res.data.passwordHash, undefined);
  });

  // --- Part 2: Route Handler Integration Tests ---
  console.log('\n--- Testing PATCH & GET /api/auth/me Handlers ---');

  // Setup mock user in memory (safe isolation: NEVER touches production database)
  const initialHash = await hashPassword('CurrentSecurePass123!');
  const mockUser = {
    id: 'user_audit_test_123',
    name: 'Initial User Name',
    email: 'audit-user@collab.internal',
    passwordHash: initialHash,
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
  };

  // Intercept Prisma operations for this test user
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;

  prisma.user.findUnique = async ({ where, select }) => {
    if (where.id === mockUser.id) {
      const out = {};
      if (select?.id) out.id = mockUser.id;
      if (select?.name) out.name = mockUser.name;
      if (select?.email) out.email = mockUser.email;
      if (select?.passwordHash) out.passwordHash = mockUser.passwordHash;
      if (select?.createdAt) out.createdAt = mockUser.createdAt;
      return out;
    }
    return originalFindUnique.call(prisma.user, { where, select });
  };

  prisma.user.update = async ({ where, data, select }) => {
    if (where.id === mockUser.id) {
      if (data.name) mockUser.name = data.name;
      if (data.passwordHash) mockUser.passwordHash = data.passwordHash;
      const out = {};
      if (select?.id) out.id = mockUser.id;
      if (select?.name) out.name = mockUser.name;
      if (select?.email) out.email = mockUser.email;
      if (select?.createdAt) out.createdAt = mockUser.createdAt;
      return out;
    }
    return originalUpdate.call(prisma.user, { where, data, select });
  };

  const validToken = await createSessionToken({
    userId: mockUser.id,
    email: mockUser.email,
    name: mockUser.name,
  });

  const validCookieHeader = `${SESSION_COOKIE_NAME}=${validToken}`;

  try {
    // 1. Unauthenticated PATCH request is rejected
    await test('Unauthenticated PATCH request is rejected with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ name: 'Should Fail' }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, 'Unauthorized');
    });

    // 2. Valid name update succeeds
    await test('Valid name update succeeds with 200 OK', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ name: 'Updated Full Name' }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.message, 'Profile updated successfully');
      assert.equal(body.user.name, 'Updated Full Name');
      assert.equal(mockUser.name, 'Updated Full Name');
    });

    // 3. Invalid short name is rejected
    await test('Invalid short name (< 2 chars) is rejected with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ name: 'X' }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Invalid input');
      assert.ok(body.issues.name);
    });

    // 4. Missing current password is rejected when changing password
    await test('Missing current password is rejected with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          name: 'Updated Full Name',
          newPassword: 'BrandNewPassword123!',
        }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Invalid input');
      assert.ok(body.issues.currentPassword);
    });

    // 5. Incorrect current password is rejected
    await test('Incorrect current password is rejected with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          name: 'Updated Full Name',
          currentPassword: 'WrongPassword999!',
          newPassword: 'BrandNewPassword123!',
        }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Incorrect current password.');
    });

    // 6. Valid password change succeeds
    await test('Valid password change succeeds and updates password hash', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          name: 'Updated Full Name',
          currentPassword: 'CurrentSecurePass123!',
          newPassword: 'NewStrongPassword2026!',
        }),
      });
      const res = await PATCH(req);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.message, 'Profile updated successfully');

      // Verify that the new password now verifies against the updated hash
      const isNewValid = await verifyPassword('NewStrongPassword2026!', mockUser.passwordHash);
      assert.equal(isNewValid, true, 'New password must verify against stored hash');

      // Verify that the old password no longer verifies
      const isOldValid = await verifyPassword('CurrentSecurePass123!', mockUser.passwordHash);
      assert.equal(isOldValid, false, 'Old password must no longer verify');
    });

    // 7. Password hashes are never exposed in responses
    await test('Password hashes are never exposed in PATCH or GET responses', async () => {
      // Test PATCH response
      const patchReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ name: 'Verified User' }),
      });
      const patchRes = await PATCH(patchReq);
      const patchBody = await patchRes.json();
      assert.equal(patchBody.user.passwordHash, undefined);
      assert.equal(JSON.stringify(patchBody).includes('passwordHash'), false);

      // Test GET response
      const getReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'GET',
        headers: {
          Cookie: validCookieHeader,
        },
      });
      const getRes = await GET(getReq);
      const getBody = await getRes.json();
      assert.equal(getBody.user.passwordHash, undefined);
      assert.equal(JSON.stringify(getBody).includes('passwordHash'), false);
    });

    // 8. CSRF protection works
    await test('CSRF protection blocks cross-site and untrusted origins', async () => {
      // Cross-site fetch metadata
      const crossSiteReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({ name: 'Malicious Edit' }),
      });
      const crossSiteRes = await PATCH(crossSiteReq);
      assert.equal(crossSiteRes.status, 403);

      // Untrusted Origin header
      const untrustedOriginReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validCookieHeader,
          Origin: 'https://evil-phishing.org',
        },
        body: JSON.stringify({ name: 'Malicious Edit' }),
      });
      const untrustedRes = await PATCH(untrustedOriginReq);
      assert.equal(untrustedRes.status, 403);
    });

    // 9. Existing GET /api/auth/me remains functional
    await test('Existing GET /api/auth/me remains functional and safe', async () => {
      // Authenticated GET
      const authGetReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'GET',
        headers: {
          Cookie: validCookieHeader,
        },
      });
      const authGetRes = await GET(authGetReq);
      assert.equal(authGetRes.status, 200);
      const authGetBody = await authGetRes.json();
      assert.equal(authGetBody.user.id, mockUser.id);
      assert.equal(authGetBody.user.email, mockUser.email);
      assert.ok(authGetBody.user.name);

      // Unauthenticated GET
      const unauthGetReq = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'GET',
      });
      const unauthGetRes = await GET(unauthGetReq);
      assert.equal(unauthGetRes.status, 401);
    });

  } finally {
    // Restore Prisma mocks
    prisma.user.findUnique = originalFindUnique;
    prisma.user.update = originalUpdate;
  }

  console.log(`\n==============================================`);
  console.log(`RESULTS: ${passed}/${total} profile verification tests passed.`);
  console.log(`==============================================\n`);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
