import { spawn } from "child_process";

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

async function run() {
  console.log("=== Starting Next.js server on port 3000 ===");
  const nextProc = spawn("npx", ["next", "dev", "-p", "3000"], {
    stdio: "inherit",
    shell: true,
  });

  await waitForUrl("http://localhost:3000/api/auth/me");
  console.log("Next.js server is ready on port 3000. Running phase9_permissions_verify.mjs...");

  const testProc = spawn("node", ["tests/phase9_permissions_verify.mjs"], {
    stdio: "inherit",
    shell: true,
  });

  testProc.on("exit", (code) => {
    console.log(`phase9_permissions_verify.mjs exited with code ${code}`);
    nextProc.kill("SIGINT");
    process.exit(code);
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
