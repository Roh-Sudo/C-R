import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../../packages/compliance-core/src/index.js';

const directory = await mkdtemp(path.join(tmpdir(), 'compliance-performance-'));
const files = Number(process.env.BENCHMARK_FILES ?? 100);
for (let index = 0; index < files; index++) await writeFile(path.join(directory, `sample-${index}.ts`), `export const value${index} = ${index};\n`);
const result = await scanDirectory(directory, { failOn: 'CRITICAL' });
console.log(JSON.stringify({ profile: files <= 100 ? 'SMALL' : 'MEDIUM', files: result.filesScanned, durationMs: result.durationMs, filesPerSecond: result.durationMs ? Number((result.filesScanned / (result.durationMs / 1000)).toFixed(2)) : null, findings: result.findings.length }, null, 2));
await rm(directory, { recursive: true, force: true });
