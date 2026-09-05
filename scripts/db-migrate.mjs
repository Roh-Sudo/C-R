#!/usr/bin/env node
// Minimal migration runner for the PostgreSQL schema used by the pilot/runtime
// adapter in db/migrations/. It applies additive migrations only.
//
// Usage:
//   node scripts/db-migrate.mjs status
//   node scripts/db-migrate.mjs deploy
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const command = process.argv[2];
const migrationsDir = path.resolve('db/migrations');

function listMigrations() {
  return readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
}

async function connect() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return { client: undefined, reason: 'DATABASE_URL is not configured' };
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return { client };
  } catch (error) {
    return { client: undefined, reason: `could not reach database: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function ensureMigrationsTable(client) {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
}

async function status() {
  const migrations = listMigrations();
  const { client, reason } = await connect();
  if (!client) {
    console.log('Database migration status: NOT CONFIGURED');
    console.log(`Reason: ${reason}`);
    console.log(`Prepared migrations (not yet applied anywhere): ${migrations.join(', ') || '(none)'}`);
    console.log('The API requires DATABASE_URL/PERSISTENCE=postgres in pilot and production mode.');
    process.exitCode = 1;
    return;
  }
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT id FROM schema_migrations ORDER BY id');
    const applied = new Set(rows.map(row => row.id));
    const pending = migrations.filter(name => !applied.has(name));
    console.log(`Applied migrations: ${[...applied].join(', ') || '(none)'}`);
    console.log(`Pending migrations: ${pending.join(', ') || '(none)'}`);
    process.exitCode = pending.length ? 1 : 0;
  } finally {
    await client.end();
  }
}

async function deploy() {
  const migrations = listMigrations();
  const { client, reason } = await connect();
  if (!client) {
    console.log('Cannot deploy migrations: database is not reachable.');
    console.log(`Reason: ${reason}`);
    process.exitCode = 1;
    return;
  }
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map(row => row.id));
    for (const name of migrations) {
      if (applied.has(name)) continue;
      const sql = readFileSync(path.join(migrationsDir, name), 'utf8');
      console.log(`Applying ${name}...`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [name]);
      console.log(`Applied ${name}`);
    }
    console.log('All migrations applied. This process only creates schema objects; it never drops or truncates tenant data.');
  } finally {
    await client.end();
  }
}

if (command === 'status') await status();
else if (command === 'deploy') await deploy();
else {
  console.error('Usage: node scripts/db-migrate.mjs <status|deploy>');
  process.exitCode = 2;
}
