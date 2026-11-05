import { spawn } from "child_process";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "@prisma/client";
import { jwtVerify } from "jose";

let BASE_URL = process.env.TEST_APP_URL || "http://localhost:3000";
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public";

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Helper to poll until the server is ready
async function waitForServer(url, timeoutMs = 35000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/me`);
      if (res.status === 401 || res.status === 200) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runTests() {
  console.log("=================================================");
  console.log("   PHASE 6 STEP 1: COLLAB TOKEN TEST SUITE       ");
  console.log("=================================================\n");

  let passedCount = 0;
  let failedCount = 0;

  function report(name, passed, detail = "") {
    if (passed) {
      console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ""}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${name}${detail ? ` - ${detail}` : ""}`);
      failedCount++;
    }
  }

  let serverProcess = null;
  const is3000Ready = await fetch("http://localhost:3000/api/auth/me")
    .then((r) => r.status === 401 || r.status === 200)
    .catch(() => false);

  if (is3000Ready) {
    BASE_URL = "http://localhost:3000";
    console.log("Using existing Next.js server running on port 3000...");
  } else {
    BASE_URL = "http://localhost:3001";
    console.log("Starting Next.js test server on port 3001...");
    serverProcess = spawn(
      "node",
      ["node_modules/next/dist/bin/next", "dev", "-p", "3001"],
      { stdio: "inherit" }
    );
  }

  const secret = process.env.AUTH_SECRET || "collab-workspace-super-secret-jwt-signing-key-32-chars-min!";
  const secretKey = new TextEncoder().encode(secret);

  async function getAuthCookie(name, email, password = "Password123!") {
    let res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.status !== 200) {
      res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
    }

    const setCookie = res.headers.get("set-cookie") || "";
    return setCookie.split(";")[0];
  }

  let cookieOwner = "";
  let cookieEditor = "";
  let cookieViewer = "";
  let cookieCommenter = "";
  let workspace1Id = "";
  let workspace2Id = "";
  let page1Id = "";
  let page2Id = "";

  try {
    await waitForServer(BASE_URL);
    console.log("Next.js test server is ready. Executing test cases...\n");

    // 1. Setup 4 Users
    cookieOwner = await getAuthCookie("Token Owner", "token_owner@workspace.dev");
    cookieEditor = await getAuthCookie("Token Editor", "token_editor@workspace.dev");
    cookieViewer = await getAuthCookie("Token Viewer", "token_viewer@workspace.dev");
    cookieCommenter = await getAuthCookie("Token Commenter", "token_commenter@workspace.dev");

    // Fetch user IDs from DB
    const userOwner = await prisma.user.findUnique({ where: { email: "token_owner@workspace.dev" } });
    const userEditor = await prisma.user.findUnique({ where: { email: "token_editor@workspace.dev" } });
    const userViewer = await prisma.user.findUnique({ where: { email: "token_viewer@workspace.dev" } });
    const userCommenter = await prisma.user.findUnique({ where: { email: "token_commenter@workspace.dev" } });

    // 2. Create Workspace 1 (owned by userOwner)
    const ws1 = await prisma.workspace.create({
      data: {
        name: "Collab Token Test Workspace",
        ownerId: userOwner.id,
      },
    });
    workspace1Id = ws1.id;

    // Create Page 1 in Workspace 1
    const p1 = await prisma.page.create({
      data: {
        title: "Collab Token Test Page",
        workspaceId: workspace1Id,
        createdById: userOwner.id,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
    page1Id = p1.id;

    // Create Workspace 2 and Page 2 (to test cross-workspace IDOR protection)
    const ws2 = await prisma.workspace.create({
      data: {
        name: "Foreign Workspace",
        ownerId: userOwner.id,
      },
    });
    workspace2Id = ws2.id;

    const p2 = await prisma.page.create({
      data: {
        title: "Foreign Page",
        workspaceId: workspace2Id,
        createdById: userOwner.id,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
    page2Id = p2.id;

    // Assign roles in Workspace 1:
    // userEditor -> EDITOR
    // userViewer -> VIEWER
    // userCommenter -> COMMENTER
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace1Id, userId: userEditor.id } },
      create: { workspaceId: workspace1Id, userId: userEditor.id, role: Role.EDITOR },
      update: { role: Role.EDITOR },
    });

    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace1Id, userId: userViewer.id } },
      create: { workspaceId: workspace1Id, userId: userViewer.id, role: Role.VIEWER },
      update: { role: Role.VIEWER },
    });

    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace1Id, userId: userCommenter.id } },
      create: { workspaceId: workspace1Id, userId: userCommenter.id, role: Role.COMMENTER },
      update: { role: Role.COMMENTER },
    });

    // TEST 1: Unauthenticated request returns 401
    const t1Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page1Id}/collab-token`,
      { method: "POST" }
    );
    report(
      "1. Unauthenticated request returns 401",
      t1Res.status === 401,
      `Status: ${t1Res.status}`
    );

    // TEST 2: OWNER receives a valid token
    const t2Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page1Id}/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieOwner },
      }
    );
    const t2Data = await t2Res.json();
    const t2CacheHeader = t2Res.headers.get("cache-control") || "";
    const t2TokenValid = t2Res.status === 200 && typeof t2Data.token === "string" && t2Data.role === "OWNER";
    report(
      "2. OWNER receives a valid token",
      t2TokenValid && t2CacheHeader.includes("no-store"),
      `Status: ${t2Res.status}, role: ${t2Data.role}, cache-control: ${t2CacheHeader}`
    );

    // TEST 3: EDITOR receives a valid token
    const t3Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page1Id}/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieEditor },
      }
    );
    const t3Data = await t3Res.json();
    const t3TokenValid = t3Res.status === 200 && typeof t3Data.token === "string" && t3Data.role === "EDITOR";
    report(
      "3. EDITOR receives a valid token",
      t3TokenValid,
      `Status: ${t3Res.status}, role: ${t3Data.role}`
    );

    // TEST 4: VIEWER receives valid collab token (Phase 9 RBAC Model B)
    const t4Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page1Id}/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieViewer },
      }
    );
    const t4Data = await t4Res.json();
    report(
      "4. VIEWER receives a valid token (Phase 9 Model B)",
      t4Res.status === 200 && t4Data.role === "VIEWER",
      `Status: ${t4Res.status}`
    );

    // TEST 5: Non-member receives 403 Forbidden
    const t5Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace2Id}/pages/${page2Id}/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieViewer }, // cookieViewer is not a member of workspace2
      }
    );
    report(
      "5. Non-member receives 403 Forbidden",
      t5Res.status === 403,
      `Status: ${t5Res.status}`
    );

    // TEST 6: Invalid page ID is rejected with 404
    const t6Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/non-existent-page-id/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieOwner },
      }
    );
    report(
      "6. Invalid page ID is rejected",
      t6Res.status === 404,
      `Status: ${t6Res.status}`
    );

    // TEST 7: Page from another workspace is rejected with 404
    const t7Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page2Id}/collab-token`,
      {
        method: "POST",
        headers: { Cookie: cookieOwner },
      }
    );
    report(
      "7. Page from another workspace is rejected",
      t7Res.status === 404,
      `Status: ${t7Res.status}`
    );

    // TEST 8: Token contains correct claims
    const { payload } = await jwtVerify(t2Data.token, secretKey, {
      algorithms: ["HS256"],
      issuer: "collab-workspace-auth",
      audience: "collab-workspace-yjs",
    });

    const claimsCorrect =
      payload.sub === userOwner.id &&
      payload.userName === "Token Owner" &&
      payload.pageId === page1Id &&
      payload.workspaceId === workspace1Id &&
      payload.role === "OWNER" &&
      payload.purpose === "collaboration" &&
      payload.iss === "collab-workspace-auth" &&
      payload.aud === "collab-workspace-yjs";

    report(
      "8. Token contains correct pageId, workspaceId, sub, and claims",
      claimsCorrect,
      `sub: ${payload.sub}, pageId: ${payload.pageId}, role: ${payload.role}`
    );

    // TEST 9: Token expires after approximately 60 seconds
    const expDiff = (payload.exp || 0) - (payload.iat || 0);
    report(
      "9. Token expires after approximately 60 seconds",
      expDiff === 60,
      `exp - iat = ${expDiff}s`
    );

    // TEST 10: Client-supplied role or userId in body CANNOT override database authorization
    const t10Res = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1Id}/pages/${page1Id}/collab-token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieViewer,
        },
        body: JSON.stringify({
          role: "OWNER",
          userId: userOwner.id,
        }),
      }
    );

    const t10Data = await t10Res.json();
    const { payload: t10Payload } = await jwtVerify(t10Data.token, secretKey, {
      algorithms: ["HS256"],
    });

    report(
      "10. Client-supplied role or userId cannot override database authorization",
      t10Payload.role === "VIEWER" && t10Payload.sub === userViewer.id,
      `Viewer with spoofed body got token with database role: ${t10Payload.role}, sub: ${t10Payload.sub}`
    );

  } catch (err) {
    console.error("Test execution exception:", err);
    report("Test execution runner", false, err.message);
  } finally {
    // Cleanup test artifacts from PostgreSQL
    try {
      if (workspace1Id) await prisma.workspace.delete({ where: { id: workspace1Id } }).catch(() => {});
      if (workspace2Id) await prisma.workspace.delete({ where: { id: workspace2Id } }).catch(() => {});
    } catch {}
    await prisma.$disconnect();
    await pool.end();

    // Terminate test server process
    try {
      if (serverProcess && serverProcess.pid) {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"]);
        } else {
          serverProcess.kill("SIGTERM");
        }
      }
    } catch {}
  }

  console.log("\n=================================================");
  console.log(`TOTAL TESTS: ${passedCount + failedCount}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);
  console.log("=================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
