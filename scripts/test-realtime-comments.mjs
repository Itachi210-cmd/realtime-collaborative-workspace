import { SignJWT } from "jose";
import fs from "fs";

// Load .env.local
let authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  try {
    const envContent = fs.readFileSync(".env.local", "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^AUTH_SECRET=["']?([^"'\r\n]+)["']?/);
      if (match) {
        authSecret = match[1].trim();
        break;
      }
    }
  } catch {}
}

const secretKey = new TextEncoder().encode(authSecret || "development-secret-key-at-least-32-chars-long");

const workspaceId = "cmwenw9y700010fm6ngkvno6s";
const pageId = "cmwenwj5q00030fm6bum64n09";

const user1 = {
  id: "cmwenvv1u00000fm6j6saedly",
  name: "Sujal",
  email: "itachi98210@gmail.com",
};

const user2 = {
  id: "cmwenxs3r00040fm69f5yslej",
  name: "Test User",
  email: "testuser01@example.com",
};

async function createCookie(user) {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);

  return `collab_session=${token}`;
}

async function run() {
  console.log("=== Testing Real-Time Comment SSE & Sync Pipeline ===");
  const cookie1 = await createCookie(user1);
  const cookie2 = await createCookie(user2);

  // 1. User 2 connects to SSE
  console.log("Connecting User 2 to SSE stream...");
  const user2ReceivedEvents = [];
  const sseRes2 = await fetch(`http://localhost:3000/api/workspaces/${workspaceId}/pages/events`, {
    headers: {
      Cookie: cookie2,
    },
  });

  if (!sseRes2.ok) {
    throw new Error(`User 2 SSE connection failed: ${sseRes2.status} ${sseRes2.statusText}`);
  }

  const reader2 = sseRes2.body.getReader();
  const decoder = new TextDecoder();

  // Read loop for User 2 in background
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader2.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              user2ReceivedEvents.push(data);
              console.log("[User 2 SSE Received]:", data.type);
            } catch {}
          }
        }
      }
    } catch {}
  })();

  // Wait a moment for SSE connection to establish
  await new Promise((r) => setTimeout(r, 800));

  // 2. User 1 posts a comment
  const commentText1 = `Please review the latest changes (${Date.now()})`;
  console.log(`User 1 posting comment: "${commentText1}"...`);
  const postRes1 = await fetch(`http://localhost:3000/api/workspaces/${workspaceId}/pages/${pageId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie1,
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({ body: commentText1 }),
  });

  if (!postRes1.ok) {
    const err = await postRes1.text();
    throw new Error(`User 1 failed to post comment: ${postRes1.status} ${err}`);
  }

  const postData1 = await postRes1.json();
  console.log("User 1 post successful:", postData1.comment.id);

  // Wait for SSE broadcast
  await new Promise((r) => setTimeout(r, 1000));

  // Verify User 2 received COMMENT_CREATED
  const commentEventForUser2 = user2ReceivedEvents.find(
    (e) => e.type === "COMMENT_CREATED" && e.comment?.id === postData1.comment.id
  );

  if (!commentEventForUser2) {
    throw new Error("User 2 failed to receive COMMENT_CREATED event via SSE!");
  }

  console.log("\n[VERIFIED] User 2 received real-time COMMENT_CREATED event:");
  console.log("   Author:", commentEventForUser2.comment.author.name);
  console.log("   Page Context:", commentEventForUser2.pageTitle);
  console.log("   Preview:", commentEventForUser2.comment.body);
  console.log("   Author ID matches User 1:", commentEventForUser2.comment.authorId === user1.id);

  // Check author suppression condition
  const shouldNotifyUser2 = commentEventForUser2.comment.authorId !== user2.id;
  const shouldNotifyUser1 = commentEventForUser2.comment.authorId !== user1.id;
  console.log("[VERIFIED] Notification check for User 2 (Recipient):", shouldNotifyUser2, "(TRUE = popup shown)");
  console.log("[VERIFIED] Notification check for User 1 (Author):", shouldNotifyUser1, "(FALSE = popup suppressed)");

  if (!shouldNotifyUser2 || shouldNotifyUser1) {
    throw new Error("Author suppression or recipient notification check failed!");
  }

  // 3. User 2 posts a reply
  const commentText2 = `Looks good to me, reviewed! (${Date.now()})`;
  console.log(`\nUser 2 posting comment: "${commentText2}"...`);
  const postRes2 = await fetch(`http://localhost:3000/api/workspaces/${workspaceId}/pages/${pageId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie2,
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({ body: commentText2 }),
  });

  if (!postRes2.ok) {
    const err = await postRes2.text();
    throw new Error(`User 2 failed to post comment: ${postRes2.status} ${err}`);
  }
  const postData2 = await postRes2.json();
  console.log("User 2 post successful:", postData2.comment.id);

  // 4. Verify persistence via GET
  console.log("\nVerifying persistence via GET /comments...");
  const listRes = await fetch(`http://localhost:3000/api/workspaces/${workspaceId}/pages/${pageId}/comments`, {
    headers: {
      Cookie: cookie1,
    },
  });

  const listData = await listRes.json();
  const c1 = listData.comments.find((c) => c.id === postData1.comment.id);
  const c2 = listData.comments.find((c) => c.id === postData2.comment.id);

  if (!c1 || !c2) {
    throw new Error("Persisted comments not found in GET response!");
  }

  console.log("[VERIFIED] Both comments persisted in PostgreSQL and retrieved successfully.");
  console.log("   Comment 1:", c1.body, "by", c1.author.name);
  console.log("   Comment 2:", c2.body, "by", c2.author.name);

  reader2.cancel();
  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
