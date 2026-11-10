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

// Ensure screenshots folder exists
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

// Helper to poll URL until ready
async function waitForUrl(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// 3. Check Collaboration server (port 1234)
let collabProc = null;
try {
  const testRes = await fetch("http://127.0.0.1:1234", { method: "GET" }).catch(() => null);
  if (!testRes) {
    console.log("[Setup] Starting Collab WebSocket server on port 1234...");
    collabProc = spawn("node", ["src/server/collab-server.mjs"], {
      stdio: "inherit",
      env: process.env,
    });
  } else {
    console.log("[Setup] Collab WebSocket server already listening on port 1234");
  }
} catch {
  // Ignored
}

// 4. Start Next.js server (port 3000)
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

  // 5. Start Chrome with remote debugging
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

  // Get WebSocket debugger URL
  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  const pages = await listRes.json();
  const wsUrl = pages[0]?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error("No webSocketDebuggerUrl found");

  // Connect CDP WebSocket
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

  const routes = [
    {
      name: "dashboard",
      url: "http://localhost:3000/dashboard",
      waitMs: 3000,
    },
    {
      name: "workspace",
      url: "http://localhost:3000/workspace/cmvxmwnji0000fgthqv7twfh0?page=cmvxmwnpg0002fgths0dbpnn7",
      waitMs: 5000,
    },
    {
      name: "login",
      url: "http://localhost:3000/login",
      waitMs: 2500,
      clearCookie: true,
    },
    {
      name: "signup",
      url: "http://localhost:3000/signup",
      waitMs: 2500,
      clearCookie: true,
    },
    {
      name: "homepage",
      url: "http://localhost:3000/",
      waitMs: 2500,
    },
  ];

  const brainDir = "C:\\Users\\SANYASI BEHERA\\.gemini\\antigravity\\brain\\b45a4fc0-18c0-44de-9891-ee7bbd663434";

  for (const route of routes) {
    console.log(`\n--- Capturing route: ${route.name} (${route.url}) ---`);

    if (route.clearCookie) {
      await sendCDP("Network.deleteCookies", { name: "collab_session", domain: "localhost" });
    } else {
      await sendCDP("Network.setCookie", {
        name: "collab_session",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
      });
    }

    await sendCDP("Page.navigate", { url: route.url });
    await new Promise((r) => setTimeout(r, route.waitMs));

    // 1. Light Theme
    await sendCDP("Runtime.evaluate", {
      expression: `
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.remove('dark');
        localStorage.setItem('collab-theme', 'light');
      `,
    });
    await new Promise((r) => setTimeout(r, 600));

    const lightRes = await sendCDP("Page.captureScreenshot", { format: "png" });
    const lightPath = path.join(screenshotsDir, `${route.name}_light.png`);
    fs.writeFileSync(lightPath, Buffer.from(lightRes.data, "base64"));
    console.log(`[PASS] Saved Light screenshot: ${lightPath}`);

    // 2. Dark Theme
    await sendCDP("Runtime.evaluate", {
      expression: `
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
        localStorage.setItem('collab-theme', 'dark');
      `,
    });
    await new Promise((r) => setTimeout(r, 600));

    const darkRes = await sendCDP("Page.captureScreenshot", { format: "png" });
    const darkPath = path.join(screenshotsDir, `${route.name}_dark.png`);
    fs.writeFileSync(darkPath, Buffer.from(darkRes.data, "base64"));
    console.log(`[PASS] Saved Dark screenshot: ${darkPath}`);

    if (fs.existsSync(brainDir)) {
      fs.copyFileSync(lightPath, path.join(brainDir, `${route.name}_light.png`));
      fs.copyFileSync(darkPath, path.join(brainDir, `${route.name}_dark.png`));
    }
  }

  console.log("\n[SUCCESS] All 5 routes captured in both Light and Dark themes successfully!");
} finally {
  console.log("[Cleanup] Shutting down browser and servers...");
  try {
    ws?.close();
  } catch {}
  try {
    chromeProc?.kill("SIGKILL");
  } catch {}
  try {
    nextProc?.kill("SIGTERM");
  } catch {}
  try {
    collabProc?.kill("SIGTERM");
  } catch {}
  try {
    process.kill(nextProc.pid);
  } catch {}
  try {
    process.kill(collabProc.pid);
  } catch {}
}

process.exit(0);
