import { spawn } from "child_process";
import http from "http";

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
  console.log("Next.js server is ready on port 3000");

  // Create reverse proxy on port 3001 -> 3000
  const proxy = http.createServer((clientReq, clientRes) => {
    const options = {
      hostname: "localhost",
      port: 3000,
      path: clientReq.url,
      method: clientReq.method,
      headers: clientReq.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on("error", (err) => {
      clientRes.writeHead(502);
      clientRes.end(err.message);
    });

    clientReq.pipe(proxyReq, { end: true });
  });

  await new Promise((resolve) => proxy.listen(3001, resolve));
  console.log("Proxy bridge ready on port 3001 -> 3000");

  async function runSuite(scriptPath) {
    console.log(`\n==============================================`);
    console.log(`RUNNING: ${scriptPath}`);
    console.log(`==============================================`);
    return new Promise((resolve) => {
      const proc = spawn("node", [scriptPath], { stdio: "inherit", shell: true });
      proc.on("exit", (code) => {
        console.log(`Finished ${scriptPath} with exit code ${code}`);
        resolve(code);
      });
    });
  }

  const results = {};
  results["phase4"] = await runSuite("tests/phase4_verify.mjs");
  results["phase5"] = await runSuite("tests/phase5_verify.mjs");
  results["phase6_token"] = await runSuite("tests/phase6_token_verify.mjs");
  results["phase9_permissions"] = await runSuite("tests/phase9_permissions_verify.mjs");

  console.log("\n=== REGRESSION SUITE RUN COMPLETE ===");
  console.log(JSON.stringify(results, null, 2));

  proxy.close();
  nextProc.kill("SIGINT");
  process.exit(Object.values(results).some((c) => c !== 0) ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
