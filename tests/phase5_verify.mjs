
const BASE_URL = "http://localhost:3001";

async function runTests() {
  console.log("=================================================");
  console.log("   PHASE 5 AUTOMATED VERIFICATION TEST SUITE    ");
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

  // 1. Authenticate Owner / Editor (User A)
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
      "1. Authenticate primary user",
      res.status === 200 && data.user.email === "intern@workspace.dev",
      `Status ${res.status}`
    );
  } catch (err) {
    report("1. Authenticate primary user", false, err.message);
  }

  // 2. Authenticate or Register Secondary User (User B for unauthorized checks)
  try {
    let res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "userb_phase5@workspace.dev",
        password: "Password123!",
      }),
    });
    if (res.status !== 200) {
      res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "User B Phase 5",
          email: "userb_phase5@workspace.dev",
          password: "Password123!",
        }),
      });
    }
    const setCookie = res.headers.get("set-cookie") || "";
    cookieUserB = setCookie.split(";")[0];
    report(
      "2. Authenticate secondary user",
      res.status === 200 || res.status === 201,
      `User B cookie acquired`
    );
  } catch (err) {
    report("2. Authenticate secondary user", false, err.message);
  }

  // 3. Create a dedicated Phase 5 workspace
  let workspaceId = "";
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ name: "Phase 5 Rich-Text Workspace" }),
    });
    const data = await res.json();
    workspaceId = data.workspace?.id || "";
    report(
      "3. Workspace created for Phase 5 testing",
      res.status === 201 && !!workspaceId,
      `Workspace ID: ${workspaceId}`
    );
  } catch (err) {
    report("3. Workspace created for Phase 5 testing", false, err.message);
  }

  // 4. Create a new document - verify default empty TipTap document initialization
  let pageId = "";
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ title: "Product Roadmap Spec" }),
    });
    const data = await res.json();
    pageId = data.page?.id || "";
    const hasDefaultContent =
      data.page?.content &&
      data.page.content.type === "doc" &&
      Array.isArray(data.page.content.content);
    report(
      "4. New page initialized with default TipTap JSON structure",
      res.status === 201 && hasDefaultContent,
      `Page ID: ${pageId}, doc type: ${data.page?.content?.type}`
    );
  } catch (err) {
    report("4. New page initialized with default TipTap JSON structure", false, err.message);
  }

  // 5. Existing pages load without errors and retain titles
  try {
    const res = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const data = await res.json();
    report(
      "5. Existing page loads and title remains intact",
      res.status === 200 && data.page?.title === "Product Roadmap Spec",
      `Title: "${data.page?.title}"`
    );
  } catch (err) {
    report("5. Existing page loads and title remains intact", false, err.message);
  }

  // 6. Update Page Title via PATCH and verify persistence after GET
  try {
    const patchRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ title: "Q4 Engineering & Product Roadmap" }),
    });
    await patchRes.json();

    const getRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const getData = await getRes.json();

    report(
      "6. Title update persists across requests",
      patchRes.status === 200 &&
        getData.page?.title === "Q4 Engineering & Product Roadmap",
      `Updated Title: "${getData.page?.title}"`
    );
  } catch (err) {
    report("6. Title update persists across requests", false, err.message);
  }

  // 7. Update Rich-Text Content with formatted TipTap JSON
  const sampleTipTapDoc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Q4 Roadmap Overview" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "This document contains " },
          { type: "text", marks: [{ type: "bold" }], text: "critical priorities" },
          { type: "text", text: " and " },
          { type: "text", marks: [{ type: "italic" }], text: "milestone goals" },
          { type: "text", text: " for our engineering sprint." },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Deliverables" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Deploy PostgreSQL database migration." }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Integrate TipTap rich-text canvas." }],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Speed and simplicity are non-negotiable." }],
          },
        ],
      },
    ],
  };

  try {
    const patchRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ content: sampleTipTapDoc }),
    });

    const getRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const getData = await getRes.json();

    const matchesNodes =
      getData.page?.content?.content?.length === 5 &&
      getData.page?.content?.content[0]?.attrs?.level === 1 &&
      getData.page?.content?.content[1]?.content[1]?.marks[0]?.type === "bold";

    report(
      "7. Rich-text content persists formatted TipTap JSON",
      patchRes.status === 200 && matchesNodes,
      `Nodes persisted: ${getData.page?.content?.content?.length}`
    );
  } catch (err) {
    report("7. Rich-text content persists formatted TipTap JSON", false, err.message);
  }

  // 8. Multiple edits do not lose the latest content
  try {
    const version2Doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Updated content revision 2" }],
        },
      ],
    };
    const version3Doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Updated content revision 3 - FINAL" }],
        },
      ],
    };

    await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ content: version2Doc }),
    });

    await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ content: version3Doc }),
    });

    const getRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const getData = await getRes.json();

    const finalText = getData.page?.content?.content[0]?.content[0]?.text;
    report(
      "8. Multiple sequential edits preserve the latest state",
      finalText === "Updated content revision 3 - FINAL",
      `Latest persisted text: "${finalText}"`
    );
  } catch (err) {
    report("8. Multiple sequential edits preserve the latest state", false, err.message);
  }

  // 9. Unauthorized user cannot update page content
  try {
    // Unauthenticated attempt
    const anonRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hacked Title" }),
    });

    // Non-member attempt (User B)
    const userBRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserB },
      body: JSON.stringify({ title: "Unauthorized Title" }),
    });

    report(
      "9. Unauthorized and non-member edits are rejected",
      anonRes.status === 401 && userBRes.status === 403,
      `Anon: ${anonRes.status}, User B: ${userBRes.status}`
    );
  } catch (err) {
    report("9. Unauthorized and non-member edits are rejected", false, err.message);
  }

  // 10. Invalid JSON / non-doc structure is rejected with 400
  try {
    const invalidTypeRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ content: { type: "invalid_root_type", data: 123 } }),
    });

    const nonObjectRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({ content: "not-a-json-object" }),
    });

    report(
      "10. Invalid JSON structures are rejected with HTTP 400",
      invalidTypeRes.status === 400 && nonObjectRes.status === 400,
      `Invalid type: ${invalidTypeRes.status}, Non-object: ${nonObjectRes.status}`
    );
  } catch (err) {
    report("10. Invalid JSON structures are rejected with HTTP 400", false, err.message);
  }

  // 11. Existing workspace and hierarchy functionality intact
  try {
    const subpageRes = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieUserA },
      body: JSON.stringify({
        title: "Sprint Architecture Subpage",
        parentPageId: pageId,
      }),
    });
    const subpageData = await subpageRes.json();
    const subpageId = subpageData.page?.id;

    const parentCheck = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const parentData = await parentCheck.json();
    const hasChild = parentData.page?.childPages?.some((c) => c.id === subpageId);

    report(
      "11. Hierarchy & subpage relationships preserved",
      subpageRes.status === 201 && hasChild,
      `Subpage ID: ${subpageId}, linked to parent: ${pageId}`
    );
  } catch (err) {
    report("11. Hierarchy & subpage relationships preserved", false, err.message);
  }

  // 12. Workspace route renders SSR page with editor correctly
  try {
    const htmlRes = await fetch(`${BASE_URL}/workspace/${workspaceId}?page=${pageId}`, {
      headers: { Cookie: cookieUserA },
    });
    const html = await htmlRes.text();
    const containsTitle = html.includes("Updated content revision 3 - FINAL") || html.includes("AppShell") || html.includes("Notion-inspired");

    report(
      "12. Workspace page route renders successfully with editor shell",
      htmlRes.status === 200 && containsTitle,
      `HTTP ${htmlRes.status}, HTML length: ${html.length}`
    );
  } catch (err) {
    report("12. Workspace page route renders successfully with editor shell", false, err.message);
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

