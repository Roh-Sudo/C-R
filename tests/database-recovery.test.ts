import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error pg is a runtime dependency without bundled TypeScript declarations.
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

suite('populated PostgreSQL migration and restore integrity', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('preserves API-created tenant data, relationships, statuses, and token-safe storage', async () => {
    const runtime = await client.query<{ state: any }>('SELECT state FROM runtime_state WHERE id = $1', ['singleton']);
    expect(runtime.rows).toHaveLength(1);
    const state = runtime.rows[0].state;
    expect(state.organizations.length).toBeGreaterThanOrEqual(2);
    expect(state.projects.length).toBeGreaterThanOrEqual(1);
    expect(state.scans.length).toBeGreaterThanOrEqual(1);
    expect(state.findings.some((item: { status: string }) => item.status === 'RESOLVED')).toBe(true);
    expect(state.memberships.some((item: { role: string }) => item.role === 'OWNER')).toBe(true);
    expect(state.audit.length).toBeGreaterThan(0);
    expect(state.projects.every((item: { tokenHash: string; token?: string }) => !item.token && item.tokenHash.length === 64)).toBe(true);
    expect(state.findings.every((item: { evidence: string }) => !item.evidence.includes('sk_live_') && !item.evidence.includes('sk_test_real'))).toBe(true);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id = '0001_init.sql'")).rows[0].count).toBe(1);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id = '0002_runtime_state.sql'")).rows[0].count).toBe(1);
  });
});
