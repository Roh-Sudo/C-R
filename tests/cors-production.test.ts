import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';
import { EnvValidationError, loadEnv } from '../apps/api/src/env.js';

describe('production CORS configuration', () => {
  it('never allows a wildcard origin when the environment schema is validated for production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', APP_URL: 'https://app.example.com', AUTH_SECRET: 'a'.repeat(32), CORS_ORIGIN: '*' })).toThrow(EnvValidationError);
  });
});

describe('CORS response headers reflect only the configured trusted origin', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-cors-${randomBytes(6).toString('hex')}.json`;
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.CORS_ORIGIN = 'https://trusted.example.com';
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
    delete process.env.CORS_ORIGIN;
  });

  it('echoes the single configured trusted origin, never a wildcard, regardless of the request Origin header', async () => {
    const response = await fetch(`${base}/health`, { headers: { origin: 'https://attacker.example.com' } });
    const allowedOrigin = response.headers.get('access-control-allow-origin');
    expect(allowedOrigin).toBe('https://trusted.example.com');
    expect(allowedOrigin).not.toBe('*');
    expect(allowedOrigin).not.toBe('https://attacker.example.com');
  });
});
