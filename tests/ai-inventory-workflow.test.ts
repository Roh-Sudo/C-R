import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { scanDirectory } from '../packages/compliance-core/src/index.js';

const CANARY_SECRET = 'sk_live_AICANARY7f3b2c9d1e4a6b8c0d2e';
const CANARY_PII = '123-45-6789';

// Real scanner output drives the AI Inventory: these tests run the existing
// detectors over synthetic repositories, ingest the result through the API, and
// read the inventory back the way the dashboard does.
describe('AI inventory workflow', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  let root: string;
  const owner = `ai_owner_${randomBytes(4).toString('hex')}`;
  const intruder = `ai_beta_${randomBytes(4).toString('hex')}`;
  let projectId: string;
  let projectToken: string;
  let betaProjectId: string;
  let betaToken: string;

  async function start(): Promise<void> {
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  }

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined, raw: text };
  }

  async function fixture(name: string, files: Record<string, string>): Promise<string> {
    const directory = path.join(root, name);
    await fs.mkdir(directory, { recursive: true });
    for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(directory, file), content);
    return directory;
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-ai-${randomBytes(6).toString('hex')}.json`);
    root = path.join(os.tmpdir(), `ai-fixtures-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(root, { recursive: true });
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    const organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'AI Demo', repositoryName: 'alpha/ai-demo' }, userId: owner });
    projectId = project.body.project.id as string;
    projectToken = project.body.token as string;
    const betaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: intruder })).body.id as string;
    const betaProject = await call('POST', '/api/projects', { body: { organizationId: betaOrg, name: 'Beta AI', repositoryName: 'beta/ai' }, userId: intruder });
    betaProjectId = betaProject.body.project.id as string;
    betaToken = betaProject.body.token as string;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  });

  it('discovers an active SDK integration and publishes it through the inventory API', async () => {
    const directory = await fixture('active', { 'app.ts': 'import OpenAI from "openai";\nconst client = new OpenAI({ model: "gpt-4o-mini" });\nexport const ask = (question: string) => client.invoke(question);\n' });
    const result = await scanDirectory(directory);
    expect(result.aiComponents.length).toBeGreaterThan(0);
    expect(result.aiComponents[0]).toMatchObject({ provider: 'OpenAI', technology: 'OpenAI SDK', discoveryMethod: 'active-import-or-config', confidence: 'HIGH', status: 'REVIEW_REQUIRED' });

    const upload = await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken });
    expect(upload.status).toBe(201);
    expect(upload.body.scan.aiComponents).toBe(result.aiComponents.length);

    const inventory = await call('GET', '/api/ai-components', { userId: owner });
    expect(inventory.status).toBe(200);
    const stored = (inventory.body as { projectId: string; provider: string; modelIdentifier?: string; discoveryMethod: string; lastDetected: string }[]).filter(item => item.projectId === projectId);
    expect(stored.length).toBe(result.aiComponents.length);
    expect(stored.some(item => item.provider === 'OpenAI' && item.modelIdentifier === 'gpt-4o-mini')).toBe(true);
    expect(stored.every(item => item.discoveryMethod === 'active-import-or-config' && Boolean(item.lastDetected))).toBe(true);
  });

  it('does not treat a dependency declaration as an active AI integration', async () => {
    const directory = await fixture('dependency', { 'package.json': JSON.stringify({ name: 'dependency-only', dependencies: { openai: '^4.0.0', '@anthropic-ai/sdk': '^0.20.0' } }, null, 2) });
    const result = await scanDirectory(directory);
    expect(result.aiComponents).toEqual([]);

    const before = ((await call('GET', '/api/ai-components', { userId: owner })).body as unknown[]).length;
    expect((await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken })).body.scan.aiComponents).toBe(0);
    expect(((await call('GET', '/api/ai-components', { userId: owner })).body as unknown[]).length).toBe(before);
  });

  it('does not treat a commented or documented provider mention as an AI system', async () => {
    const directory = await fixture('comment', { 'notes.ts': '// Documentation only: import OpenAI from "openai" and call new OpenAI().\n/* Evaluating anthropic later: import anthropic */\n' });
    const result = await scanDirectory(directory);
    expect(result.aiComponents).toEqual([]);

    const before = ((await call('GET', '/api/ai-components', { userId: owner })).body as unknown[]).length;
    expect((await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken })).body.scan.aiComponents).toBe(0);
    expect(((await call('GET', '/api/ai-components', { userId: owner })).body as unknown[]).length).toBe(before);
  });

  it('keeps the inventory after an API restart and retains a component the code no longer contains', async () => {
    const beforeRestart = ((await call('GET', '/api/ai-components', { userId: owner })).body as { id: string; projectId: string; lastDetected: string }[]).filter(item => item.projectId === projectId);
    await new Promise(resolve => server.close(resolve));
    await start();
    const afterRestart = ((await call('GET', '/api/ai-components', { userId: owner })).body as { id: string; projectId: string; lastDetected: string }[]).filter(item => item.projectId === projectId);
    expect(afterRestart.map(item => item.id).sort()).toEqual(beforeRestart.map(item => item.id).sort());

    // Historical semantics: the inventory records that an integration was seen.
    // Removing the code does not delete the record; only lastDetected goes stale.
    const removed = await fixture('removed', { 'app.ts': 'export const ask = (question: string) => question.trim();\n' });
    const rescan = await scanDirectory(removed);
    expect(rescan.aiComponents).toEqual([]);
    expect((await call('POST', '/api/scans', { body: { projectId, result: rescan }, token: projectToken })).body.scan.aiComponents).toBe(0);
    const afterRemoval = ((await call('GET', '/api/ai-components', { userId: owner })).body as { id: string; projectId: string; lastDetected: string }[]).filter(item => item.projectId === projectId);
    expect(afterRemoval.map(item => item.id).sort()).toEqual(beforeRestart.map(item => item.id).sort());
    expect(afterRemoval.every(item => item.lastDetected === beforeRestart.find(entry => entry.id === item.id)!.lastDetected)).toBe(true);
  });

  it('keeps AI inventory records scoped to the owning organization', async () => {
    const directory = await fixture('beta', { 'bot.ts': 'import Anthropic from "@anthropic-ai/sdk";\nconst client = new Anthropic({ model: "claude-3-haiku" });\nexport const reply = (q: string) => client.invoke(q);\n' });
    const result = await scanDirectory(directory);
    expect(result.aiComponents.some(item => item.provider === 'Anthropic')).toBe(true);
    expect((await call('POST', '/api/scans', { body: { projectId: betaProjectId, result }, token: betaToken })).status).toBe(201);

    const alpha = (await call('GET', '/api/ai-components', { userId: owner })).body as { projectId: string; provider: string }[];
    expect(alpha.some(item => item.projectId === betaProjectId)).toBe(false);
    expect(alpha.some(item => item.provider === 'Anthropic')).toBe(false);
    const beta = (await call('GET', '/api/ai-components', { userId: intruder })).body as { projectId: string; provider: string }[];
    expect(beta.every(item => item.projectId === betaProjectId)).toBe(true);
    expect((await call('GET', '/api/ai-components')).body).toEqual([]);
  });

  it('never exposes raw secrets or personal data through AI discovery or its findings', async () => {
    const directory = await fixture('sensitive', { 'app.ts': `import OpenAI from "openai";\nconst client = new OpenAI();\nconst apiKey = "${CANARY_SECRET}";\nconst customer = { ssn: "${CANARY_PII}" };\nconst response = client.invoke(customer.ssn);\nconsole.log(response);\n` });
    const result = await scanDirectory(directory);
    expect(result.aiComponents.some(item => item.provider === 'OpenAI')).toBe(true);
    expect(result.findings.map(item => item.ruleId)).toEqual(expect.arrayContaining(['AI-001']));

    expect((await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken })).status).toBe(201);
    const inventory = await call('GET', '/api/ai-components', { userId: owner });
    const findings = await call('GET', '/api/findings', { userId: owner });
    const persisted = await fs.readFile(dataFile, 'utf8');
    for (const payload of [inventory.raw, findings.raw, persisted, JSON.stringify(result.aiComponents)]) {
      expect(payload).not.toContain(CANARY_SECRET);
      expect(payload).not.toContain(CANARY_PII);
    }
    // AI discovery records location metadata only, never prompt or response content.
    expect(Object.keys(inventory.body[0])).not.toContain('evidence');
  });
});
