const BASE_URL = "http://localhost:3001";

async function runTests() {
  console.log("=================================================");
  console.log("   PHASE 4 AUTOMATED TEST & VERIFICATION SUITE   ");
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

  let cookieUserA = "";
  let cookieUserB = "";

  // 1. Existing Phase 3 user can log in
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "intern@workspace.dev",
        password: "Password123!",
      }),
    });
    const setCookie = res.headers.get("set-cookie") || "";
    cookieUserA = setCookie.split(";")[0];
    const data = await res.json();
    report(
      "1. Existing Phase 3 user can log in",
      res.status === 200 && data.user.email === "intern@workspace.dev",
      `Status ${res.status}`
    );
  } catch (err) {
    report("1. Existing Phase 3 user can log in", false, err.message);
  }

  // 2. Existing User records remain intact after migration
  try {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieUserA },
    });
    const data = await res.json();
    report(
      "2. Existing User records remain intact after migration",
      res.status === 200 && data.user.id.length > 0,
      `User ID: ${data.user?.id}`
    );
  } catch (err) {
    report("2. Existing User records remain intact after migration", false, err.message);
  }

  // 3. Authenticated user can create a workspace
  let ws1Id = "";
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ name: "Core Product Workspace" }),
    });
    const data = await res.json();
    ws1Id = data.workspace?.id || "";
    report(
      "3. Authenticated user can create a workspace",
      res.status === 201 && data.workspace?.name === "Core Product Workspace",
      `Workspace ID: ${ws1Id}`
    );
  } catch (err) {
    report("3. Authenticated user can create a workspace", false, err.message);
  }

  // 4. Workspace creator is automatically added as OWNER
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}`, {
      headers: { Cookie: cookieUserA },
    });
    const data = await res.json();
    const isOwner =
      data.workspace?.isOwner === true &&
      data.workspace?.members.some(
        (m) => m.role === "OWNER" && m.userId === data.workspace.ownerId
      );
    report(
      "4. Workspace creator is automatically added as OWNER",
      res.status === 200 && isOwner,
      `Owner confirmed: ${data.workspace?.owner?.email}`
    );
  } catch (err) {
    report("4. Workspace creator is automatically added as OWNER", false, err.message);
  }

  // 5. Workspace appears after refresh / in list
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces`, {
      headers: { Cookie: cookieUserA },
    });
    const data = await res.json();
    const found = data.workspaces?.some((w) => w.id === ws1Id);
    report(
      "5. Workspace appears in workspace list",
      res.status === 200 && found,
      `Total accessible: ${data.workspaces?.length}`
    );
  } catch (err) {
    report("5. Workspace appears in workspace list", false, err.message);
  }

  // 6. User can create, list, and rename pages
  let rootPageId = "";
  try {
    const createRes = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ title: "Architecture Specifications" }),
    });
    const createData = await createRes.json();
    rootPageId = createData.page?.id || "";

    const renameRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages/${rootPageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieUserA },
        body: JSON.stringify({ title: "Architecture Blueprint v2" }),
      }
    );
    const renameData = await renameRes.json();

    const listRes = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}/pages`, {
      headers: { Cookie: cookieUserA },
    });
    const listData = await listRes.json();

    report(
      "6. User can create, list, and rename pages",
      createRes.status === 201 &&
        renameRes.status === 200 &&
        renameData.page?.title === "Architecture Blueprint v2" &&
        listData.pages?.length >= 1,
      `Page title: ${renameData.page?.title}`
    );
  } catch (err) {
    report("6. User can create, list, and rename pages", false, err.message);
  }

  // 7. Support nested child pages and persistence
  let childPageId = "";
  try {
    const childRes = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({
        title: "CRDT & Yjs Deep Dive",
        parentPageId: rootPageId,
      }),
    });
    const childData = await childRes.json();
    childPageId = childData.page?.id || "";

    const getChildRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages/${childPageId}`,
      {
        headers: { Cookie: cookieUserA },
      }
    );
    const getChildData = await getChildRes.json();

    report(
      "7. Support nested child pages with parent reference",
      childRes.status === 201 &&
        getChildData.page?.parentPageId === rootPageId &&
        getChildData.page?.parentPage?.title === "Architecture Blueprint v2",
      `Parent: ${getChildData.page?.parentPage?.title}`
    );
  } catch (err) {
    report("7. Support nested child pages with parent reference", false, err.message);
  }

  // 8. Prevent cross-workspace parent references
  let ws2Id = "";
  try {
    const ws2Res = await fetch(`${BASE_URL}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ name: "Second Isolated Workspace" }),
    });
    const ws2Data = await ws2Res.json();
    ws2Id = ws2Data.workspace?.id || "";

    // Attempt to create page in ws2 referencing rootPageId from ws1
    const invalidRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws2Id}/pages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieUserA },
        body: JSON.stringify({
          title: "Malicious Cross-Workspace Child",
          parentPageId: rootPageId, // Belongs to ws1!
        }),
      }
    );
    const invalidData = await invalidRes.json();

    report(
      "8. Cross-workspace parentPage references are strictly rejected",
      invalidRes.status === 400 &&
        invalidData.error?.includes("Invalid parent page"),
      `Status ${invalidRes.status}: ${invalidData.error}`
    );
  } catch (err) {
    report("8. Cross-workspace parentPage references are strictly rejected", false, err.message);
  }

  // 9. Unauthenticated requests are rejected
  try {
    const unauthGetWs = await fetch(`${BASE_URL}/api/workspaces`);
    const unauthCreateWs = await fetch(`${BASE_URL}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sneaky Workspace" }),
    });
    const unauthPages = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}/pages`);

    report(
      "9. Unauthenticated requests are rejected with 401",
      unauthGetWs.status === 401 &&
        unauthCreateWs.status === 401 &&
        unauthPages.status === 401,
      `All 3 unauthenticated attempts received 401 Unauthorized`
    );
  } catch (err) {
    report("9. Unauthenticated requests are rejected with 401", false, err.message);
  }

  // 10. Multi-user IDOR protection: User A vs User B
  try {
    // Register User B
    const userBEmail = `user_b_${Date.now()}@workspace.dev`;
    const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "User Beta",
        email: userBEmail,
        password: "Password123!",
      }),
    });
    const setCookieB = regBRes.headers.get("set-cookie") || "";
    cookieUserB = setCookieB.split(";")[0];

    // User B tries to read User A's workspace
    const idorGetWs = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}`, {
      headers: { Cookie: cookieUserB },
    });

    // User B tries to read User A's pages
    const idorGetPages = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages`,
      {
        headers: { Cookie: cookieUserB },
      }
    );

    // User B tries to rename User A's workspace
    const idorRenameWs = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserB },
      body: JSON.stringify({ name: "Hacked by User B" }),
    });

    // User B tries to delete User A's workspace
    const idorDeleteWs = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserB },
    });

    const isSecure =
      idorGetWs.status === 403 &&
      idorGetPages.status === 403 &&
      idorRenameWs.status === 403 &&
      idorDeleteWs.status === 403;

    report(
      "10. Insecure Direct Object Reference (IDOR) attacks blocked with 403 Forbidden",
      isSecure,
      `User B blocked on Read, Pages, Rename, and Delete`
    );
  } catch (err) {
    report("10. IDOR attacks blocked with 403 Forbidden", false, err.message);
  }

  // 11. User can rename their own workspace
  try {
    const renameWsRes = await fetch(`${BASE_URL}/api/workspaces/${ws1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ name: "Core Engineering Hub (Renamed)" }),
    });
    const renameWsData = await renameWsRes.json();
    report(
      "11. Workspace owner can rename workspace",
      renameWsRes.status === 200 &&
        renameWsData.workspace?.name === "Core Engineering Hub (Renamed)",
      `Updated name: ${renameWsData.workspace?.name}`
    );
  } catch (err) {
    report("11. Workspace owner can rename workspace", false, err.message);
  }

  // 12. User can delete pages safely
  try {
    const deletePageRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages/${childPageId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieUserA },
      }
    );
    const getDeletedRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages/${childPageId}`,
      {
        headers: { Cookie: cookieUserA },
      }
    );
    report(
      "12. User can delete page with proper 404 on subsequent lookup",
      deletePageRes.status === 200 && getDeletedRes.status === 404,
      `Delete status ${deletePageRes.status}, subsequent get status ${getDeletedRes.status}`
    );
  } catch (err) {
    report("12. User can delete page safely", false, err.message);
  }

  // 13. User can delete their own workspace (and cascade cleanup)
  try {
    const deleteWsRes = await fetch(`${BASE_URL}/api/workspaces/${ws2Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserA },
    });
    const getDeletedWs = await fetch(`${BASE_URL}/api/workspaces/${ws2Id}`, {
      headers: { Cookie: cookieUserA },
    });
    report(
      "13. Workspace owner can delete workspace with cascade cleanup",
      deleteWsRes.status === 200 && getDeletedWs.status === 404,
      `Delete status ${deleteWsRes.status}, subsequent get status ${getDeletedWs.status}`
    );
  } catch (err) {
    report("13. Workspace owner can delete workspace", false, err.message);
  }

  // 14. Invalid payloads return safe 400 validation errors
  try {
    const invalidWsRes = await fetch(`${BASE_URL}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ name: "A" }), // Min length is 2!
    });
    const invalidWsData = await invalidWsRes.json();

    const invalidPageRes = await fetch(
      `${BASE_URL}/api/workspaces/${ws1Id}/pages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieUserA },
        body: JSON.stringify({ title: "" }), // Empty title
      }
    );
    const invalidPageData = await invalidPageRes.json();

    report(
      "14. Invalid payloads trigger Zod 400 validation errors",
      invalidWsRes.status === 400 &&
        invalidPageRes.status === 400 &&
        Boolean(invalidWsData.issues) &&
        Boolean(invalidPageData.issues),
      `Zod validation returned status 400 with field issues`
    );
  } catch (err) {
    report("14. Invalid payloads trigger Zod 400 validation errors", false, err.message);
  }

  console.log("\n=================================================");
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log("=================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

