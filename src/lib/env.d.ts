export const MIN_AUTH_SECRET_LENGTH: number;
export const INTERNAL_RPC_SECRET_REGEX: RegExp;
export const DEV_DEFAULT_DATABASE_URL: string;

export function redactUrlCredentials(rawUrl: string): string;
export function isPlaceholderSecret(value: string): boolean;

export function validateAuthSecret(
  secret: unknown,
  options?: { isProduction?: boolean }
): {
  valid: boolean;
  error?: string;
  warning?: string;
};

export function validateInternalRpcSecretValue(secret: unknown): {
  valid: boolean;
  error?: string;
};

export function validateDatabaseUrl(
  url: unknown,
  options?: { isProduction?: boolean }
): {
  valid: boolean;
  error?: string;
  isDefaultDevFallback?: boolean;
};

export function validateRedisConfig(options?: {
  enabledEnv?: string;
  urlEnv?: string;
  isProduction?: boolean;
}): {
  valid: boolean;
  enabled: boolean;
  error?: string;
  warning?: string;
};

export function validateUrlEnv(
  name: string,
  value: unknown,
  options: { protocols: string[]; required?: boolean }
): {
  valid: boolean;
  error?: string;
  warning?: string;
};

export function validatePortEnv(
  name: string,
  value: unknown
): {
  valid: boolean;
  port?: number;
  error?: string;
};

export function validatePositiveIntEnv(
  name: string,
  value: unknown
): {
  valid: boolean;
  value?: number;
  error?: string;
};

export function normalizeOrigin(rawOrigin: string): string;

export function getAuthSecretKey(options?: {
  env?: Record<string, string | undefined>;
}): Uint8Array;

export function getDatabaseUrl(options?: {
  env?: Record<string, string | undefined>;
}): string;

export interface EnvCheckItem {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export function validateRuntimeEnv(options?: {
  env?: Record<string, string | undefined>;
  target?: "next" | "collab" | "all";
  isProduction?: boolean;
  strict?: boolean;
  throwOnError?: boolean;
}): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: EnvCheckItem[];
};
