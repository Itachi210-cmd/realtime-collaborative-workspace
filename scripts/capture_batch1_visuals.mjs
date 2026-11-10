import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { SignJWT } from "jose";

// 1. Load .env.local
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = val;
    }
  }
}

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  console.error("Missing AUTH_SECRET in .env.local");
  process.exit(1);
}

const screenshotsDir = path.resolve(process.cwd(), "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// 2. Generate signed session token
const secretKey = new TextEncoder().encode(AUTH_SECRET);
const sessionToken = await new SignJWT({
  userId: "cmvxk7tuu00002sth56ss5jrg",
  email: "intern@workspace.dev",
  name: "Intern Engineer",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(secretKey);

console.log("[Setup] Generated session token for Intern Engineer");

async function waitForUrl(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// Check Collab server (port 1234)
let collabProc = null;
try {
  const testRes = await fetch("http://127.0.0.1:1234").catch(() => null);
  if (!testRes) {
    console.log("[Setup] Starting Collab WebSocket server on port 1234...");
    collabProc = spawn("node", ["src/server/collab-server.mjs"], {
      stdio: "inherit",
      env: process.env,
    });
  } else {
    console.log("[Setup] Collab server already running on port 1234");
  }
} catch {}

// Start Next.js dev server (port 3000)
console.log("[Setup] Starting Next.js dev server on port 3000...");
const nextProc = spawn(
  "node",
  ["node_modules/next/dist/bin/next", "dev", "-p", "3000"],
  {
    stdio: "inherit",
    env: process.env,
  }
);

let chromeProc = null;
let ws = null;

try {
  await waitForUrl("http://127.0.0.1:3000");
  console.log("[Setup] Next.js dev server is ready at http://localhost:3000");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const cdpPort = 9222;
  const tempProfile = path.resolve(process.env.TEMP || "C:\\temp", "chrome_cdp_profile_" + Date.now());

  console.log("[Setup] Launching headless Chrome with remote debugging...");
  chromeProc = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tempProfile}`,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`);
  console.log("[Setup] Chrome CDP is ready");

  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  const pages = await listRes.json();
  const wsUrl = pages[0]?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error("No webSocketDebuggerUrl found");

  ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let msgId = 1;
  function sendCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (evt) => {
        const data = JSON.parse(evt.data.toString());
        if (data.id === id) {
          ws.removeEventListener("message", handler);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Set session cookie
  await sendCDP("Network.enable");
  await sendCDP("Network.setCookie", {
    name: "collab_session",
    value: sessionToken,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });

  await sendCDP("Page.enable");
  await sendCDP("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const brainDir = "C:\\Users\\SANYASI BEHERA\\.gemini\\antigravity\\brain\\b45a4fc0-18c0-44de-9891-ee7bbd663434";

  async function saveScreenshot(filename) {
    const res = await sendCDP("Page.captureScreenshot", { format: "png" });
    const localPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(localPath, Buffer.from(res.data, "base64"));
    if (fs.existsSync(brainDir)) {
      fs.copyFileSync(localPath, path.join(brainDir, filename));
    }
    console.log(`[PASS] Saved: ${filename}`);
  }

  async function setTheme(mode) {
    await sendCDP("Runtime.evaluate", {
      expression: `
        document.documentElement.setAttribute('data-theme', '${mode}');
        if ('${mode}' === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('collab-theme', '${mode}');
      `,
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  const targetUrl = "http://localhost:3000/workspace/cmvxmwnji0000fgthqv7twfh0?page=cmvxmwnpg0002fgths0dbpnn7";
  console.log(`[Navigate] Navigating to ${targetUrl}...`);
  await sendCDP("Page.navigate", { url: targetUrl });
  await new Promise((r) => setTimeout(r, 6000));

  // --- Step 1: Baseline Screen 1 & Screen 2 (Sidebar, AppShell, Manuscript Canvas) ---
  console.log("\n=== 1. Workspace Baseline (Screen 1 & 2) ===");
  await setTheme("light");
  await saveScreenshot("batch1_screen1_2_light.png");

  await setTheme("dark");
  await saveScreenshot("batch1_screen1_2_dark.png");

  // --- Step 2: Workspace Switcher Dropdown ---
  console.log("\n=== 2. Workspace Switcher Dropdown ===");
  await sendCDP("Runtime.evaluate", {
    expression: `
      const btn = document.querySelector('aside button[aria-haspopup="true"]');
      if (btn) btn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  await saveScreenshot("batch1_switcher_dropdown_dark.png");

  await setTheme("light");
  await saveScreenshot("batch1_switcher_dropdown_light.png");

  // Close dropdown by clicking the backdrop overlay
  await sendCDP("Runtime.evaluate", {
    expression: `
      const backdrop = document.querySelector('.fixed.inset-0.z-30');
      if (backdrop) backdrop.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 600));

  // --- Step 3: Comments Panel (Screen 3) ---
  console.log("\n=== 3. Comments Marginalia Panel ===");
  await setTheme("dark");
  await sendCDP("Runtime.evaluate", {
    expression: `
      const commentBtn = document.querySelector('button[aria-label="Open comments"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Comments'));
      if (commentBtn) commentBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 800));
  await saveScreenshot("batch1_comments_panel_dark.png");

  await setTheme("light");
  await saveScreenshot("batch1_comments_panel_light.png");

  // Close comments panel cleanly
  await sendCDP("Runtime.evaluate", {
    expression: `
      const closeBtn = document.querySelector('button[aria-label="Close comments"]');
      if (closeBtn) closeBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 600));

  // --- Step 4: Version History Panel (Screen 3) ---
  console.log("\n=== 4. Version History Panel ===");
  await setTheme("dark");
  await sendCDP("Runtime.evaluate", {
    expression: `
      const historyBtn = document.querySelector('button[aria-label="Open version history"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('History'));
      if (historyBtn) historyBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1200));
  await saveScreenshot("batch1_history_panel_dark.png");

  await setTheme("light");
  await saveScreenshot("batch1_history_panel_light.png");

  // --- Step 5: Version History Preview (ReadOnlyPreview) ---
  console.log("\n=== 5. Historical Version Preview (ReadOnlyPreview) ===");
  await setTheme("dark");
  await sendCDP("Runtime.evaluate", {
    expression: `
      const previewBtn = document.querySelector('button[title="Preview this version"]');
      if (previewBtn) {
        previewBtn.click();
      } else {
        // If no version snapshots exist yet, create one first
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Save Current Version'));
        if (saveBtn) saveBtn.click();
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 1200));

  // If we clicked save, fill form and submit
  await sendCDP("Runtime.evaluate", {
    expression: `
      const labelInput = document.querySelector('input[placeholder*="Snapshot label"]');
      if (labelInput) {
        labelInput.value = 'Phase 1 Arch Blueprint Draft';
        labelInput.dispatchEvent(new Event('input', { bubbles: true }));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Save Version'));
        if (submitBtn) submitBtn.click();
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Now click preview on the created snapshot
  await sendCDP("Runtime.evaluate", {
    expression: `
      const previewBtn = document.querySelector('button[title="Preview this version"]');
      if (previewBtn) previewBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1000));
  await saveScreenshot("batch1_history_preview_dark.png");

  // --- Step 6: Restore Confirmation Dialog ---
  console.log("\n=== 6. Restore Confirmation Dialog ===");
  await sendCDP("Runtime.evaluate", {
    expression: `
      const restoreBtn = document.querySelector('button[title="Restore this version"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Restore Version'));
      if (restoreBtn) restoreBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 800));
  await saveScreenshot("batch1_restore_dialog_dark.png");

  await setTheme("light");
  await saveScreenshot("batch1_restore_dialog_light.png");

  console.log("\n[SUCCESS] All Batch 1 Visual QA screenshots captured successfully!");
} finally {
  console.log("[Cleanup] Shutting down browser and servers...");
  try { ws?.close(); } catch {}
  try { chromeProc?.kill("SIGKILL"); } catch {}
  try { nextProc?.kill("SIGTERM"); } catch {}
  try { collabProc?.kill("SIGTERM"); } catch {}
  try { process.kill(nextProc.pid); } catch {}
  try { process.kill(collabProc.pid); } catch {}
}

process.exit(0);
