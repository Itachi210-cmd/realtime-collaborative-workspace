import { redactUrlCredentials } from '../lib/env.mjs';

const SENSITIVE_KEY_PATTERN =
  /^(password|pass|token|jwt|secret|cookie|authorization|auth_secret|internal_rpc_secret|database_url|redis_url)$/i;

/**
 * Redacts credentials from URLs and sensitive key-value objects before logging.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeLogValue(value) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.includes('://') && value.includes('@')) {
      return redactUrlCredentials(value);
    }
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeLogValue(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeLogValue(v);
      }
    }
    return out;
  }

  return value;
}

/**
 * Emits a structured single-line JSON operational log to stdout/stderr.
 *
 * @param {'info' | 'warn' | 'error'} level
 * @param {string} component
 * @param {string} event
 * @param {Record<string, unknown>} [meta]
 */
export function logStructured(level, component, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...sanitizeLogValue(meta),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

