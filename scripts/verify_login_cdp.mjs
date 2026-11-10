import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 3000;
const CDP_PORT = 9223;
const BASE_URL = `http://localhost:${PORT}`;

async function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const msg = JSON.stringify({ id, method, params });
    const handler = (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === id) {
        ws.off("message", handler);
        if (resp.error) reject(resp.error);
        else resolve(resp.result);
      }
    };
    ws.on("message", handler);
    ws.send(msg);
  });
}

async function evalCdp(ws, expression) {
  const res = await sendCdp(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res?.result?.value;
}

async function run() {
  console.log("=== CDP LOGIN CLIENT-SIDE INTERACTION VERIFICATION ===\n");

  let nextProc = null;
  let isServerRunning = false;
  try {
    const probe = await fetch(`${BASE_URL}/login`);
    if (probe.status < 500) isServerRunning = true;
  } catch {}

  if (!isServerRunning) {
    console.log("Starting Next.js dev server on port 3000...");
    nextProc = spawn("npx", ["next", "dev", "-p", "3000"], {
      stdio: "ignore",
      shell: true,
    });
    const start = Date.now();
    while (Date.now() - start < 25000) {
      try {
        const res = await fetch(`${BASE_URL}/login`);
        if (res.status < 500) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("Dev server ready.\n");
  }

  const tmpProfile = path.resolve(process.cwd(), "tmp_chrome_login_verify");
  if (!fs.existsSync(tmpProfile)) fs.mkdirSync(tmpProfile, { recursive: true });

  const chromeProc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${tmpProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-gpu",
    ],
    { stdio: "ignore" }
  );

  await new Promise((r) => setTimeout(r, 1500));

  let versionData;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      versionData = await res.json();
      if (versionData && versionData.length > 0) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  const pageTarget = versionData[0];
  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  await new Promise((resolve) => ws.on("open", resolve));
  await sendCdp(ws, "Page.enable");
  await sendCdp(ws, "Runtime.enable");
  await sendCdp(ws, "DOM.enable");

  // 1. Navigate to /login
  console.log("1. Navigating to http://localhost:3000/login...");
  await sendCdp(ws, "Page.navigate", { url: `${BASE_URL}/login` });
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Verify Initial Layout & Elements
  const initialCheck = await evalCdp(
    ws,
    `(() => {
      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      const submitBtn = document.querySelector('button[type="submit"]');
      const heading = document.querySelector('h1')?.innerText;
      const leftHeading = document.querySelector('h2')?.innerText;
      return {
        hasEmail: !!emailInput,
        hasPass: !!passInput,
        passType: passInput?.getAttribute('type'),
        hasSubmit: !!submitBtn,
        heading,
        leftHeading,
      };
    })()`
  );

  console.log("Initial Check:", initialCheck);
  if (!initialCheck.hasEmail || !initialCheck.hasPass || initialCheck.passType !== "password") {
    throw new Error("Initial login elements verification failed");
  }
  console.log("✓ PASS: Initial elements present, password input type is 'password'");

  // 3. Test Password Visibility Toggle
  console.log("\n2. Testing Password Visibility Toggle...");
  const toggleRes = await evalCdp(
    ws,
    `(() => {
      return new Promise((resolve) => {
        const toggleBtn = document.querySelector('button[aria-label="Show password"]');
        if (!toggleBtn) return resolve({ error: "Toggle button not found" });
        toggleBtn.click();

        setTimeout(() => {
          const passInput = document.getElementById('login-password');
          const typeAfterFirstClick = passInput.getAttribute('type');

          const hideBtn = document.querySelector('button[aria-label="Hide password"]');
          if (hideBtn) hideBtn.click();

          setTimeout(() => {
            const typeAfterSecondClick = passInput.getAttribute('type');
            resolve({ typeAfterFirstClick, typeAfterSecondClick });
          }, 150);
        }, 150);
      });
    })()`
  );
  console.log("Toggle Result:", toggleRes);
  if (toggleRes.typeAfterFirstClick !== "text" || toggleRes.typeAfterSecondClick !== "password") {
    throw new Error("Password visibility toggle failed");
  }
  console.log("✓ PASS: Password toggle toggles between 'text' and 'password' smoothly");

  // 4. Test Client-Side Form Validation (Empty fields)
  console.log("\n3. Testing Empty Submission Validation...");
  const validationRes = await evalCdp(
    ws,
    `(() => {
      const submitBtn = document.querySelector('button[type="submit"]');
      submitBtn.click();
      return new Promise((resolve) => {
        setTimeout(() => {
          const bodyText = document.body.innerText;
          const hasEmailErr = bodyText.includes("Please enter a valid email address.");
          resolve({ hasEmailErr });
        }, 300);
      });
    })()`
  );
  console.log("Validation Result:", validationRes);
  if (!validationRes.hasEmailErr) {
    throw new Error("Client validation error for empty submission missing");
  }
  console.log("✓ PASS: Validation error shown for empty/invalid submission");

  // 5. Test Invalid Credentials Error Handling
  console.log("\n4. Testing Invalid Credentials Submission...");
  const invalidLoginRes = await evalCdp(
    ws,
    `(() => {
      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      const submitBtn = document.querySelector('button[type="submit"]');

      function setReactValue(input, val) {
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        descriptor.set.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      setReactValue(emailInput, "wrong@editorial.dev");
      setReactValue(passInput, "WrongPassword999!");

      submitBtn.click();

      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const bodyText = document.body.innerText;
          if (bodyText.includes("Invalid email or password")) {
            return resolve({ hasInvalidMsg: true });
          }
          if (Date.now() - start > 5000) {
            return resolve({ hasInvalidMsg: false, bodyText: bodyText.slice(0, 300) });
          }
          setTimeout(check, 100);
        };
        check();
      });
    })()`
  );
  console.log("Invalid Login Result:", invalidLoginRes);
  if (!invalidLoginRes.hasInvalidMsg) {
    throw new Error("Invalid credentials error message banner did not appear");
  }
  console.log("✓ PASS: General error banner correctly displayed on invalid credentials");

  // 6. Test Theme Toggle
  console.log("\n5. Testing Theme Toggle (Light <-> Dark)...");
  const themeRes = await evalCdp(
    ws,
    `(() => {
      const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const themeBtn = document.querySelector('button[aria-label="Toggle theme"]');
      if (!themeBtn) return { error: "Theme toggle button not found" };

      themeBtn.click();
      const themeAfterClick = document.documentElement.getAttribute('data-theme');

      themeBtn.click();
      const themeAfterSecondClick = document.documentElement.getAttribute('data-theme');

      return { initialTheme, themeAfterClick, themeAfterSecondClick };
    })()`
  );
  console.log("Theme Toggle Result:", themeRes);
  if (themeRes.themeAfterClick === themeRes.initialTheme) {
    throw new Error("Theme toggle did not switch data-theme attribute");
  }
  console.log("✓ PASS: Theme toggle switches data-theme attribute cleanly");

  // 7. Test Responsive Layouts
  console.log("\n6. Testing Responsive Layouts...");
  // Desktop 1280px
  await sendCdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 300));
  const desktopLayout = await evalCdp(
    ws,
    `(() => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const leftCol = document.querySelector('h2');
      const rightCol = document.querySelector('h1');
      return {
        noHorizontalOverflow: scrollW <= clientW,
        leftVisible: !!leftCol && leftCol.offsetParent !== null,
        rightVisible: !!rightCol && rightCol.offsetParent !== null,
      };
    })()`
  );
  console.log("Desktop 1280px Layout:", desktopLayout);

  // Mobile 375px
  await sendCdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 300));
  const mobileLayout = await evalCdp(
    ws,
    `(() => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const rightCol = document.querySelector('h1');
      return {
        noHorizontalOverflow: scrollW <= clientW,
        rightVisible: !!rightCol && rightCol.offsetParent !== null,
      };
    })()`
  );
  console.log("Mobile 375px Layout:", mobileLayout);
  if (!mobileLayout.noHorizontalOverflow) {
    throw new Error("Mobile layout caused horizontal overflow!");
  }
  console.log("✓ PASS: Responsive layout adapts cleanly without horizontal overflow");

  // 8. Test Navigation to Signup and Back
  console.log("\n7. Testing Navigation between Login and Signup...");
  const navRes = await evalCdp(
    ws,
    `(() => {
      const signupLink = document.querySelector('a[href*="/signup"]');
      if (!signupLink) return { error: "Signup link not found" };
      signupLink.click();
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            currentUrl: window.location.href,
            heading: document.querySelector('h1')?.innerText,
          });
        }, 1000);
      });
    })()`
  );
  console.log("Navigation to Signup Result:", navRes);
  if (!navRes.currentUrl.includes("/signup")) {
    throw new Error("Navigation to signup page failed");
  }
  console.log("✓ PASS: Navigation to signup page succeeded");

  ws.close();
  chromeProc.kill();
  if (nextProc) nextProc.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 1000));
  try {
    fs.rmSync(tmpProfile, { recursive: true, force: true });
  } catch {}

  console.log("\n=== ALL CLIENT-SIDE CDP VERIFICATION TESTS PASSED (100%) ===");
}

run().catch((err) => {
  console.error("CDP verification error:", err);
  process.exit(1);
});
