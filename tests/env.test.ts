import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../apps/api/src/env.js';

describe('typed environment validation', () => {
  it('defaults to development when NODE_ENV is unset and never requires production secrets', () => {
    const env = loadEnv({});
    expect(env.nodeEnv).toBe('development');
    expect(env.port).toBe(8787);
  });

  it('rejects production startup when critical configuration is missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(EnvValidationError);
    try {
      loadEnv({ NODE_ENV: 'production' });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).missing).toEqual(expect.arrayContaining(['DATABASE_URL', 'APP_URL', 'AUTH_SECRET']));
    }
  });

  it('rejects a wildcard CORS origin in production', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_URL: 'https://app.example.com', AUTH_SECRET: 'a'.repeat(32) };
    expect(() => loadEnv({ ...base, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    expect(() => loadEnv({ ...base, CORS_ORIGIN: 'https://app.example.com' })).not.toThrow();
  });

  it('requires APP_URL to use https in production', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_SECRET: 'a'.repeat(32), CORS_ORIGIN: 'https://app.example.com' };
    expect(() => loadEnv({ ...base, APP_URL: 'http://app.example.com' })).toThrow(/https/);
  });

  it('accepts a fully configured production environment', () => {
    const env = loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_URL: 'https://app.example.com', AUTH_SECRET: 'a'.repeat(32), CORS_ORIGIN: 'https://app.example.com' });
    expect(env.nodeEnv).toBe('production');
    expect(env.databaseUrl).toBe('postgres://x');
  });

  it('requires PostgreSQL in explicit pilot mode and never silently selects JSON', () => {
    expect(() => loadEnv({ PILOT_MODE: 'true' })).toThrow(/PostgreSQL persistence/);
    expect(loadEnv({ PILOT_MODE: 'true', DATABASE_URL: 'postgres://x' }).persistence).toBe('postgres');
    expect(loadEnv({ PERSISTENCE: 'json' }).persistence).toBe('json');
  });
});
