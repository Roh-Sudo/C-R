// Typed environment validation, separated by NODE_ENV. Production startup must
// fail loudly on missing critical configuration instead of silently falling
// back to a development default. Never logs secret values.

export type NodeEnv = 'development' | 'test' | 'production';
export type EnvConfig = {
 nodeEnv: NodeEnv;
 port: number;
 corsOrigin: string;
 databaseUrl?: string;
 appUrl?: string;
 authSecret?: string;
 githubWebhookSecret?: string;
 billingWebhookSecret?: string;
 adminToken?: string;
 persistence: 'json' | 'postgres';
};

export class EnvValidationError extends Error {
 constructor(readonly missing: string[], message: string) { super(message); this.name = 'EnvValidationError'; }
}

/** Vars that must be present and non-empty before the process is allowed to serve production traffic. */
export const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'APP_URL', 'AUTH_SECRET'] as const;

function resolveNodeEnv(value: string | undefined): NodeEnv {
 return value === 'production' || value === 'test' ? value : 'development';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
 const nodeEnv = resolveNodeEnv(source.NODE_ENV);
 if (nodeEnv === 'production') {
  const missing = REQUIRED_IN_PRODUCTION.filter(key => !source[key] || source[key]!.trim().length === 0);
  if (missing.length) throw new EnvValidationError(missing, `missing required production environment variables: ${missing.join(', ')}`);
  if (!source.CORS_ORIGIN || source.CORS_ORIGIN.trim() === '*') throw new EnvValidationError(['CORS_ORIGIN'], 'CORS_ORIGIN must be an explicit trusted origin in production; a wildcard origin is not allowed');
  if (!source.APP_URL!.startsWith('https://')) throw new EnvValidationError(['APP_URL'], 'APP_URL must use https:// in production');
 }
 const persistence = source.PERSISTENCE === 'json' ? 'json' : (source.PERSISTENCE === 'postgres' || source.DATABASE_URL ? 'postgres' : 'json');
 if (persistence === 'postgres' && !source.DATABASE_URL) throw new EnvValidationError(['DATABASE_URL'], 'PostgreSQL persistence requires DATABASE_URL');
 if ((nodeEnv === 'production' || source.PILOT_MODE === 'true') && persistence !== 'postgres') throw new EnvValidationError(['DATABASE_URL', 'PERSISTENCE'], 'production and pilot mode require PostgreSQL persistence');
 return {
  nodeEnv,
  port: Number(source.PORT ?? 8787),
  corsOrigin: source.CORS_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: source.DATABASE_URL,
  appUrl: source.APP_URL,
  authSecret: source.AUTH_SECRET,
  githubWebhookSecret: source.GITHUB_WEBHOOK_SECRET,
  billingWebhookSecret: source.LOCAL_BILLING_WEBHOOK_SECRET,
    adminToken: source.ADMIN_TOKEN,
    persistence
 };
}
