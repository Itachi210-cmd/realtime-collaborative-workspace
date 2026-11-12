/**
 * Centralized Environment & Secrets Validation
 * Real-Time Collaborative Workspace - Phase 12 Step 2
 *
 * Edge-safe, zero-filesystem module shared across Next.js App Router,
 * Edge Middleware, standalone Node.js collaboration server, and CLI preflight checks.
 * Never logs, exposes, or embeds actual secret values in error messages.
 */

export const MIN_AUTH_SECRET_LENGTH = 32;
export const INTERNAL_RPC_SECRET_REGEX = /^[0-9a-fA-F]{64}$/;

export const DEV_DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public';

const PLACEHOLDER_PATTERNS = [
  'change-this',
  'replace-with',
  'your-secret',
  'your_secret',
  'placeholder',
  'changeme',
  'example-secret',
  'insert-secret',
];

const DEV_ONLY_WEAK_PATTERNS = ['super-secret-jwt-signing-key'];

/**
 * Redacts userinfo/password credentials from any connection URL before logging.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function redactUrlCredentials(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '[unset]';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password || parsed.username) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString();
  } catch {
    return '[invalid-url-redacted]';
  }
}

/**
 * Detects known example/placeholder secret strings (case-insensitive).
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isPlaceholderSecret(value) {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Validates AUTH_SECRET for presence, minimum length, character diversity,
 * and absence of known placeholder strings.
 *
 * @param {unknown} secret
 * @param {{ isProduction?: boolean }} [options]
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
export function validateAuthSecret(secret, options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';

  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    return {
      valid: false,
      error:
        'AUTH_SECRET is missing. Define a high-entropy secret of at least 32 characters.',
    };
  }

  const trimmed = secret.trim();
  if (trimmed.length < MIN_AUTH_SECRET_LENGTH) {
    return {
      valid: false,
      error: `AUTH_SECRET is too short (${trimmed.length} chars). Minimum required length is ${MIN_AUTH_SECRET_LENGTH} characters.`,
    };
  }

  if (isPlaceholderSecret(trimmed)) {
    return {
      valid: false,
      error:
        'AUTH_SECRET appears to be a placeholder value. Generate a cryptographically random secret.',
    };
  }

  if (new Set(trimmed).size < 8) {
    return {
      valid: false,
      error:
        'AUTH_SECRET has insufficient entropy (too few distinct characters). Generate a cryptographically random secret.',
    };
  }

  const lower = trimmed.toLowerCase();
  if (DEV_ONLY_WEAK_PATTERNS.some((pattern) => lower.includes(pattern))) {
    if (isProduction) {
      return {
        valid: false,
        error:
          'AUTH_SECRET uses a known local-dev default pattern and is forbidden in production. Generate a new cryptographically random secret.',
      };
    }
    return {
      valid: true,
      warning:
        'AUTH_SECRET uses a known local-dev default pattern; rotate it to a cryptographically random secret before production.',
    };
  }

  return { valid: true };
}

/**
 * Validates INTERNAL_RPC_SECRET for presence, exact 64-hex-character format
 * (32 cryptographically random bytes), and basic entropy.
 *
 * @param {unknown} secret
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateInternalRpcSecretValue(secret) {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    return {
      valid: false,
      error:
        'INTERNAL_RPC_SECRET is required and cannot be empty. Fallback to AUTH_SECRET is forbidden.',
    };
  }

  if (!INTERNAL_RPC_SECRET_REGEX.test(secret)) {
    return {
      valid: false,
      error:
        'INTERNAL_RPC_SECRET must be exactly 64 hexadecimal characters (32 cryptographically random bytes).',
    };
  }

  if (new Set(secret.toLowerCase()).size < 4) {
    return {
      valid: false,
      error:
        'INTERNAL_RPC_SECRET has insufficient entropy. Generate 32 cryptographically random bytes in hex format.',
    };
  }

  return { valid: true };
}

/**
 * Validates DATABASE_URL format and enforces explicit configuration in production.
 * Never includes connection string or password in error messages.
 *
 * @param {unknown} url
 * @param {{ isProduction?: boolean }} [options]
 * @returns {{ valid: boolean, error?: string, isDefaultDevFallback?: boolean }}
 */
export function validateDatabaseUrl(url, options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    if (isProduction) {
      return {
        valid: false,
        error: 'DATABASE_URL is required in production and cannot be empty.',
      };
    }
    return { valid: true, isDefaultDevFallback: true };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      error: 'DATABASE_URL is not a valid PostgreSQL connection URL.',
    };
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return {
      valid: false,
      error: 'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    };
  }

  if (!parsed.hostname) {
    return {
      valid: false,
      error: 'DATABASE_URL must include a valid database hostname.',
    };
  }

  if (
    isProduction &&
    parsed.username === 'username' &&
    parsed.password === 'password'
  ) {
    return {
      valid: false,
      error:
        'DATABASE_URL still uses placeholder credentials. Configure real database credentials.',
    };
  }

  return { valid: true, isDefaultDevFallback: false };
}

/**
 * Validates Redis configuration when enabled.
 *
 * @param {{ enabledEnv?: string, urlEnv?: string, isProduction?: boolean }} [options]
 * @returns {{ valid: boolean, enabled: boolean, error?: string, warning?: string }}
 */
export function validateRedisConfig(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const enabledEnv = options.enabledEnv;
  const urlEnv = options.urlEnv;

  if (enabledEnv === 'false' || urlEnv === 'disabled') {
    return { valid: true, enabled: false };
  }

  if (enabledEnv !== undefined && enabledEnv !== '' && enabledEnv !== 'true') {
    return {
      valid: false,
      enabled: true,
      error: 'REDIS_ENABLED must be "true" or "false" when specified.',
    };
  }

  if (!urlEnv || typeof urlEnv !== 'string' || urlEnv.trim().length === 0) {
    if (isProduction) {
      return {
        valid: false,
        enabled: true,
        error:
          'REDIS_URL is required in production when Redis is enabled (or set REDIS_ENABLED=false for single-instance mode).',
      };
    }
    return {
      valid: true,
      enabled: true,
      warning: 'REDIS_URL is not set; defaulting to redis://localhost:6379 in development.',
    };
  }

  let parsed;
  try {
    parsed = new URL(urlEnv);
  } catch {
    return {
      valid: false,
      enabled: true,
      error: 'REDIS_URL is not a valid Redis URL.',
    };
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    return {
      valid: false,
      enabled: true,
      error: 'REDIS_URL must use the redis:// or rediss:// protocol.',
    };
  }

  return { valid: true, enabled: true };
}

/**
 * Validates an HTTP(S) or WS(S) URL variable.
 *
 * @param {string} name
 * @param {unknown} value
 * @param {{ protocols: string[], required?: boolean }} options
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
export function validateUrlEnv(name, value, options) {
  const { protocols, required = false } = options;

  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    if (required) {
      return { valid: false, error: `${name} is required and cannot be empty.` };
    }
    return { valid: true };
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { valid: false, error: `${name} must be a valid URL.` };
  }

  if (!protocols.includes(parsed.protocol)) {
    return {
      valid: false,
      error: `${name} must use one of the following protocols: ${protocols.join(', ')}.`,
    };
  }

  return { valid: true };
}

/**
 * Validates an integer port number (1-65535).
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {{ valid: boolean, port?: number, error?: string }}
 */
export function validatePortEnv(name, value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return { valid: false, error: `${name} must be a valid integer port between 1 and 65535.` };
  }
  const num = Number(str);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    return { valid: false, error: `${name} must be a valid integer port between 1 and 65535.` };
  }
  return { valid: true, port: num };
}

/**
 * Validates a positive integer millisecond setting.
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validatePositiveIntEnv(name, value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return { valid: false, error: `${name} must be a positive integer.` };
  }
  const num = Number(str);
  if (!Number.isInteger(num) || num <= 0) {
    return { valid: false, error: `${name} must be greater than 0.` };
  }
  return { valid: true, value: num };
}

/**
 * Normalizes an origin string (strips trailing slashes when valid URL).
 *
 * @param {string} rawOrigin
 * @returns {string}
 */
export function normalizeOrigin(rawOrigin) {
  const trimmed = rawOrigin.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Returns the validated AUTH_SECRET encoded as Uint8Array for JOSE JWT operations.
 * Throws a safe error message that never reveals the secret value.
 *
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {Uint8Array}
 */
export function getAuthSecretKey(options = {}) {
  const env = options.env || process.env;
  const isProduction = env.NODE_ENV === 'production';
  const result = validateAuthSecret(env.AUTH_SECRET, { isProduction });
  if (!result.valid) {
    throw new Error(`[AuthConfig] ${result.error}`);
  }
  return new TextEncoder().encode(env.AUTH_SECRET.trim());
}

/**
 * Returns the validated DATABASE_URL for Prisma / pg Pool initialization.
 * In production, throws if DATABASE_URL is missing or invalid.
 * In non-production, allows safe fallback to local development PostgreSQL.
 *
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function getDatabaseUrl(options = {}) {
  const env = options.env || process.env;
  const isProduction = env.NODE_ENV === 'production';
  const result = validateDatabaseUrl(env.DATABASE_URL, { isProduction });

  if (!result.valid) {
    throw new Error(`[DatabaseConfig] ${result.error}`);
  }

  if (result.isDefaultDevFallback) {
    return DEV_DEFAULT_DATABASE_URL;
  }

  return env.DATABASE_URL.trim();
}

/**
 * Validates all environment variables for the specified runtime target.
 *
 * @param {Object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {'next' | 'collab' | 'all'} [options.target='all']
 * @param {boolean} [options.isProduction]
 * @param {boolean} [options.strict=false] Require production-grade settings even outside NODE_ENV=production
 * @param {boolean} [options.throwOnError=false]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], checks: Array<{ name: string, status: 'ok' | 'warn' | 'error', message: string }> }}
 */
export function validateRuntimeEnv(options = {}) {
  const env = options.env || process.env;
  const isProduction = options.isProduction ?? env.NODE_ENV === 'production';
  const strict = Boolean(options.strict) || isProduction;
  const target = options.target || 'all';

  const errors = [];
  const warnings = [];
  const checks = [];

  const record = (name, status, message) => {
    checks.push({ name, status, message });
    if (status === 'error') errors.push(`${name}: ${message}`);
    if (status === 'warn') warnings.push(`${name}: ${message}`);
  };

  // 1. AUTH_SECRET (Required for both Next.js and Collab Server)
  const authCheck = validateAuthSecret(env.AUTH_SECRET, { isProduction: strict });
  if (!authCheck.valid) {
    record('AUTH_SECRET', 'error', authCheck.error);
  } else if (authCheck.warning) {
    record('AUTH_SECRET', 'warn', authCheck.warning);
  } else {
    record('AUTH_SECRET', 'ok', `Configured (${env.AUTH_SECRET.trim().length} chars)`);
  }

  // 2. DATABASE_URL (Required for both Next.js and Collab Server)
  const dbCheck = validateDatabaseUrl(env.DATABASE_URL, { isProduction: strict });
  if (!dbCheck.valid) {
    record('DATABASE_URL', 'error', dbCheck.error);
  } else if (dbCheck.isDefaultDevFallback) {
    record('DATABASE_URL', 'warn', 'Not set; using local development fallback.');
  } else {
    record('DATABASE_URL', 'ok', `Configured (${redactUrlCredentials(env.DATABASE_URL)})`);
  }

  // 3. INTERNAL_RPC_SECRET (Always required for Collab Server & strict/prod Next.js)
  const rpcCheck = validateInternalRpcSecretValue(env.INTERNAL_RPC_SECRET);
  const hasRpcSecret =
    typeof env.INTERNAL_RPC_SECRET === 'string' &&
    env.INTERNAL_RPC_SECRET.trim().length > 0;
  if (!rpcCheck.valid) {
    if (target === 'collab' || target === 'all' || strict || hasRpcSecret) {
      record('INTERNAL_RPC_SECRET', 'error', rpcCheck.error);
    } else {
      record(
        'INTERNAL_RPC_SECRET',
        'warn',
        'Not configured; cross-process version snapshot flush/restore RPC will fail.'
      );
    }
  } else {
    record('INTERNAL_RPC_SECRET', 'ok', 'Configured (64 hex chars)');
  }

  // 4. Public URLs (NEXT_PUBLIC_APP_URL & NEXT_PUBLIC_COLLAB_WS_URL)
  const appUrlCheck = validateUrlEnv('NEXT_PUBLIC_APP_URL', env.NEXT_PUBLIC_APP_URL, {
    protocols: ['http:', 'https:'],
    required: strict && (target === 'next' || target === 'all'),
  });
  if (!appUrlCheck.valid) {
    record('NEXT_PUBLIC_APP_URL', 'error', appUrlCheck.error);
  } else if (!env.NEXT_PUBLIC_APP_URL) {
    record('NEXT_PUBLIC_APP_URL', 'warn', 'Not set; defaulting to localhost origins in dev.');
  } else {
    record('NEXT_PUBLIC_APP_URL', 'ok', `Configured (${env.NEXT_PUBLIC_APP_URL})`);
  }

  if (target === 'next' || target === 'all') {
    const wsUrlCheck = validateUrlEnv(
      'NEXT_PUBLIC_COLLAB_WS_URL',
      env.NEXT_PUBLIC_COLLAB_WS_URL,
      {
        protocols: ['ws:', 'wss:'],
        required: false,
      }
    );
    if (!wsUrlCheck.valid) {
      record('NEXT_PUBLIC_COLLAB_WS_URL', 'error', wsUrlCheck.error);
    } else if (!env.NEXT_PUBLIC_COLLAB_WS_URL) {
      const level = strict ? 'warn' : 'ok';
      record(
        'NEXT_PUBLIC_COLLAB_WS_URL',
        level,
        'Not set; client resolves WebSocket URL from window.location hostname:1234.'
      );
    } else {
      record('NEXT_PUBLIC_COLLAB_WS_URL', 'ok', `Configured (${env.NEXT_PUBLIC_COLLAB_WS_URL})`);
    }
  }

  // 5. Collab Server & Redis settings
  if (target === 'collab' || target === 'all') {
    const portCheck = validatePortEnv('COLLAB_PORT', env.COLLAB_PORT);
    if (!portCheck.valid) {
      record('COLLAB_PORT', 'error', portCheck.error);
    } else {
      record('COLLAB_PORT', 'ok', `Port ${portCheck.port ?? 1234}`);
    }

    const authTimeoutCheck = validatePositiveIntEnv(
      'COLLAB_AUTH_TIMEOUT_MS',
      env.COLLAB_AUTH_TIMEOUT_MS
    );
    if (!authTimeoutCheck.valid) {
      record('COLLAB_AUTH_TIMEOUT_MS', 'error', authTimeoutCheck.error);
    }

    const cleanupGraceCheck = validatePositiveIntEnv(
      'COLLAB_CLEANUP_GRACE_MS',
      env.COLLAB_CLEANUP_GRACE_MS
    );
    if (!cleanupGraceCheck.valid) {
      record('COLLAB_CLEANUP_GRACE_MS', 'error', cleanupGraceCheck.error);
    }

    const redisCheck = validateRedisConfig({
      enabledEnv: env.REDIS_ENABLED,
      urlEnv: env.REDIS_URL,
      isProduction: strict,
    });
    if (!redisCheck.valid) {
      record('REDIS_URL', 'error', redisCheck.error);
    } else if (!redisCheck.enabled) {
      record('REDIS', 'ok', 'Disabled (single-instance mode)');
    } else if (redisCheck.warning) {
      record('REDIS_URL', 'warn', redisCheck.warning);
    } else {
      record('REDIS_URL', 'ok', `Configured (${redactUrlCredentials(env.REDIS_URL)})`);
    }
  }

  const ok = errors.length === 0;
  if (!ok && options.throwOnError) {
    throw new Error(
      `[EnvValidation] Invalid environment configuration (${errors.length} error(s)):\n - ${errors.join('\n - ')}`
    );
  }

  return { ok, errors, warnings, checks };
}
