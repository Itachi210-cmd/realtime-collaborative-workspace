/**
 * Environment & Secrets Preflight Validation Script
 * Real-Time Collaborative Workspace - Phase 12 Step 2
 *
 * Usage:
 *   node scripts/validate_env.mjs
 *   node scripts/validate_env.mjs --strict
 *   node scripts/validate_env.mjs --target=collab
 *
 * Validates all required environment variables, formats, and secret strength
 * without ever printing or exposing secret values.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function loadLocalEnvFiles() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const candidates = [
    `.env.${nodeEnv}.local`,
    '.env.local',
    `.env.${nodeEnv}`,
    '.env',
  ];

  for (const file of candidates) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch (err) {
      console.warn(`[EnvCheck] Warning: Failed reading ${file}: ${err.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict') || args.includes('--production');
  const targetArg = args.find((a) => a.startsWith('--target='));
  const target = targetArg ? targetArg.split('=')[1] : 'all';

  if (!['next', 'collab', 'all'].includes(target)) {
    console.error(`[EnvCheck] Invalid --target="${target}". Expected next, collab, or all.`);
    process.exit(1);
  }

  loadLocalEnvFiles();

  const envModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'src/lib/env.mjs')).href;
  const { validateRuntimeEnv } = await import(envModuleUrl);

  const result = validateRuntimeEnv({
    target,
    strict,
    throwOnError: false,
  });

  console.log(`\n=== Environment & Secrets Validation (target=${target}, strict=${strict}) ===`);
  for (const item of result.checks) {
    const tag = item.status === 'ok' ? 'OK   ' : item.status === 'warn' ? 'WARN ' : 'ERROR';
    console.log(`[${tag}] ${item.name}: ${item.message}`);
  }

  if (!result.ok) {
    console.error(`\nValidation FAILED with ${result.errors.length} error(s).`);
    process.exit(1);
  }

  console.log(
    `\nValidation PASSED (${result.checks.length} checks, ${result.warnings.length} warning(s)).\n`
  );
}

main().catch((err) => {
  console.error('[EnvCheck] Unexpected error:', err.message);
  process.exit(1);
});

