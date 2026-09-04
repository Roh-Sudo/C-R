#!/usr/bin/env node
// Production readiness gate. Runs the mandatory checks and prints a single
// PASS/FAIL report per category plus one overall READY / NOT READY verdict.
// Exits non-zero when the overall verdict is NOT READY so it can gate CI.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const results = [];

function run(label, command, options = {}) {
  const start = Date.now();
  try {
    const output = execSync(command, { stdio: 'pipe', encoding: 'utf8', ...options });
    results.push({ label, status: 'PASS', durationMs: Date.now() - start });
    return { ok: true, output };
  } catch (error) {
    results.push({ label, status: 'FAIL', durationMs: Date.now() - start, detail: error.stdout?.toString().slice(-2000) ?? error.message });
    return { ok: false, output: error.stdout?.toString() ?? '' };
  }
}

function record(label, ok, detail) {
  results.push({ label, status: ok ? 'PASS' : 'FAIL', detail });
}

console.log('Running production readiness checks...\n');

run('Build', 'npm run build');
run('Lint', 'npm run lint');
run('Tests (unit + integration + security + tenant isolation)', 'npm test');
run('Scanner Quality', 'npm run quality:benchmark');

// Environment schema self-check: proves production startup actually rejects
// missing/insecure configuration, without relying on the current process env.
try {
  const { loadEnv, EnvValidationError } = await import('../dist/apps/api/src/env.js');
  let rejected = false;
  try {
    loadEnv({ NODE_ENV: 'production' });
  } catch (error) {
    rejected = error instanceof EnvValidationError;
  }
  const accepted = (() => {
    try {
      loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', APP_URL: 'https://app.example.com', AUTH_SECRET: 'a'.repeat(32), CORS_ORIGIN: 'https://app.example.com' });
      return true;
    } catch {
      return false;
    }
  })();
  record('Environment schema', rejected && accepted, rejected && accepted ? undefined : 'production env validation did not behave as expected');
} catch (error) {
  record('Environment schema', false, error instanceof Error ? error.message : String(error));
}

// Secret leakage scan over application source only (excludes intentionally
// fake fixtures under benchmarks/fixtures and examples/).
try {
  const { scanDirectory } = await import('../dist/packages/compliance-core/src/index.js');
  const targets = ['apps/api/src', 'apps/cli/src', 'apps/web/src', 'packages/compliance-core/src', 'packages/pilot-core/src', 'packages/billing-core/src'];
  let secretFindings = 0;
  for (const target of targets) {
    if (!existsSync(target)) continue;
    const result = await scanDirectory(target, { failOn: 'CRITICAL' });
    secretFindings += result.findings.filter(finding => finding.category === 'SECRET').length;
  }
  record('Secret leakage scan (application source)', secretFindings === 0, secretFindings ? `${secretFindings} potential secret finding(s) in application source` : undefined);
} catch (error) {
  record('Secret leakage scan (application source)', false, error instanceof Error ? error.message : String(error));
}

// Dependency vulnerabilities: informational-but-gating for high/critical issues.
try {
  execSync('npm audit --omit=dev --audit-level=high', { stdio: 'pipe', encoding: 'utf8' });
  record('Dependency vulnerabilities (high/critical, prod deps)', true);
} catch (error) {
  const output = error.stdout?.toString() ?? '';
  record('Dependency vulnerabilities (high/critical, prod deps)', false, output.slice(-1500));
}

// Database migration status: honestly reflects that the reference app still
// uses a local JSON store; migrations are prepared but not applied/wired.
{
  const dbCheck = run('Database migration status', 'node scripts/db-migrate.mjs status');
  results[results.length - 1].label = 'Database';
}

// Container build: best-effort; environments without docker are marked FAIL,
// not fabricated as PASS.
try {
  execSync('docker --version', { stdio: 'pipe' });
  const apiBuild = run('Container build (api)', 'docker build -f docker/api.Dockerfile -t compliance-api:readiness-check .');
  const webBuild = run('Container build (web)', 'docker build -f docker/web.Dockerfile -t compliance-web:readiness-check .');
  record('Container', apiBuild.ok && webBuild.ok);
} catch {
  record('Container', false, 'docker is not available in this environment');
}

const categoryOrder = ['Build', 'Lint', 'Tests (unit + integration + security + tenant isolation)', 'Scanner Quality', 'Environment schema', 'Secret leakage scan (application source)', 'Dependency vulnerabilities (high/critical, prod deps)', 'Database', 'Container'];
const byLabel = new Map(results.map(item => [item.label, item]));

console.log('\nPRODUCTION READINESS\n');
const displayNames = {
  'Build': 'Build', 'Lint': 'Lint', 'Tests (unit + integration + security + tenant isolation)': 'Tests', 'Scanner Quality': 'Scanner Quality',
  'Environment schema': 'Environment', 'Secret leakage scan (application source)': 'Security Regression',
  'Dependency vulnerabilities (high/critical, prod deps)': 'Dependencies', 'Database': 'Database', 'Container': 'Container'
};
let allPass = true;
for (const label of categoryOrder) {
  const item = byLabel.get(label);
  const ok = item?.status === 'PASS';
  allPass = allPass && ok;
  console.log(`${displayNames[label] ?? label}: ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`Tenant Isolation: ${byLabel.get('Tests (unit + integration + security + tenant isolation)')?.status === 'PASS' ? 'PASS' : 'FAIL'} (covered by tests/tenant-isolation.test.ts within the Tests gate)`);
console.log(`Security Regression: ${byLabel.get('Secret leakage scan (application source)')?.status === 'PASS' && byLabel.get('Tests (unit + integration + security + tenant isolation)')?.status === 'PASS' ? 'PASS' : 'FAIL'}`);

console.log(`\nOverall:\n${allPass ? 'READY' : 'NOT READY'}`);

for (const item of results) {
  if (item.status === 'FAIL' && item.detail) console.log(`\n--- ${item.label} failure detail (truncated) ---\n${item.detail}`);
}

process.exitCode = allPass ? 0 : 1;
