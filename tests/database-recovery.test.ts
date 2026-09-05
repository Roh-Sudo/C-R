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
    expect(state.memberships.some((item: { role: string }) => item.role === 'OWNER')).toBe(true);
    expect(state.projects.every((item: { tokenHash: string; token?: string }) => !item.token && item.tokenHash.length === 64)).toBe(true);

    // Scans, findings, and the audit log moved out of the runtime_state document
    // into the normalized tables in migration 0003.
    expect(state.scans).toEqual([]);
    expect(state.findings).toEqual([]);
    const scans = await client.query('SELECT * FROM scans');
    const findings = await client.query('SELECT * FROM findings');
    const scanRows = scans.rows as { id: string; organization_id: string; project_id: string }[];
    const findingRows = findings.rows as { status: string; evidence: string; organization_id: string; project_id: string; scan_id: string }[];
    expect(scanRows.length).toBeGreaterThanOrEqual(1);
    expect(findingRows.some(item => item.status === 'RESOLVED')).toBe(true);
    expect(findingRows.every(item => !item.evidence.includes('sk_live_') && !item.evidence.includes('sk_test_real'))).toBe(true);
    const projectIds = new Set(scanRows.map(item => item.project_id));
    expect(findingRows.every(item => projectIds.has(item.project_id))).toBe(true);
    expect((await client.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count).toBeGreaterThan(0);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id = '0001_init.sql'")).rows[0].count).toBe(1);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id = '0002_runtime_state.sql'")).rows[0].count).toBe(1);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id = '0003_normalized_scan_ingestion.sql'")).rows[0].count).toBe(1);
  });
});
