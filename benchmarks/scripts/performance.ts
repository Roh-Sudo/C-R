import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../../packages/compliance-core/src/index.js';

const sizes = [100, 1_000, 10_000];
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 3);
const cliPath = path.resolve('dist/apps/cli/src/index.js');
const extensions = ['.ts', '.js', '.json', '.yaml', '.py', '.java', '.properties'];
type CliMeasurement = { elapsedMs: number; scannerDurationMs: number; filesScanned: number; findings: number; rssKb: number | null; outputBytes: number };

function median(values: number[]): number { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.floor(sorted.length / 2)]; }
function sourceFor(index: number, extension: string): string {
	if (index % 17 === 0) return `const apiKey = "sk_live_benchmark_${String(index).padStart(8, '0')}";\nexport const id = ${index};\n`;
	if (extension === '.json') return JSON.stringify({ id: index, uuid: '550e8400-e29b-41d4-a716-446655440000', checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' });
	if (extension === '.yaml' || extension === '.properties') return `id: ${index}\nstatus: clean\nmessage: synthetic benchmark fixture\n`;
	if (extension === '.py') return `value_${index} = ${index}\nprint("benchmark")\n`;
	if (extension === '.java') return `class Fixture${index} { int value = ${index}; }\n`;
	return `export const value${index} = ${index};\nexport const requestId = "550e8400-e29b-41d4-a716-446655440000";\n`;
}
async function makeRepository(fileCount: number): Promise<{ directory: string; ignoredFiles: number }> {
	const directory = await mkdtemp(path.join(tmpdir(), `compliance-performance-${fileCount}-`));
	let ignoredFiles = 0;
	for (let index = 0; index < fileCount; index++) {
		const ignored = index % 20 === 0;
		const relativeDirectory = ignored ? (index % 40 === 0 ? 'node_modules/generated' : 'dist/generated') : `src/nested/${index % 25}`;
		const extension = extensions[index % extensions.length];
		await fs.mkdir(path.join(directory, relativeDirectory), { recursive: true });
		await writeFile(path.join(directory, relativeDirectory, `fixture-${index}${extension}`), sourceFor(index, extension));
		if (ignored) ignoredFiles++;
	}
	return { directory, ignoredFiles };
}
async function runCli(directory: string, format: 'console' | 'json' | 'sarif'): Promise<CliMeasurement> {
	const started = performance.now();
	const child = spawn(process.execPath, [cliPath, directory, '--format', format, '--fail-on', 'high']);
	let stdout = '';
	let stderr = '';
	let peakRssKb = 0;
	const monitor = setInterval(async () => {
		try {
			const status = await fs.readFile(`/proc/${child.pid}/status`, 'utf8');
			const match = status.match(/^VmRSS:\s+(\d+) kB$/m);
			if (match) peakRssKb = Math.max(peakRssKb, Number(match[1]));
		} catch { /* process may have exited between polling and reading /proc */ }
	}, 10);
	child.stdout.on('data', chunk => { stdout += String(chunk); });
	child.stderr.on('data', chunk => { stderr += String(chunk); });
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', code => resolve(code ?? 1));
	});
	clearInterval(monitor);
	if (exitCode !== 0 && exitCode !== 1) throw new Error(`CLI benchmark failed (${exitCode}): ${stderr}`);
	const elapsedMs = performance.now() - started;
	if (format === 'json') {
		const result = JSON.parse(stdout) as { durationMs: number; filesScanned: number; findings: unknown[] };
		return { elapsedMs, scannerDurationMs: result.durationMs, filesScanned: result.filesScanned, findings: result.findings.length, rssKb: peakRssKb || null, outputBytes: Buffer.byteLength(stdout) };
	}
	return { elapsedMs, scannerDurationMs: 0, filesScanned: 0, findings: 0, rssKb: peakRssKb || null, outputBytes: Buffer.byteLength(stdout) };
}
async function measureSize(fileCount: number): Promise<Record<string, unknown>> {
	const { directory, ignoredFiles } = await makeRepository(fileCount);
	try {
		const measurements: CliMeasurement[] = [];
		for (let iteration = 0; iteration < iterations; iteration++) measurements.push(await runCli(directory, 'json'));
		const jsonOnce = measurements[0];
		const sarif = await runCli(directory, 'sarif');
		const consoleReport = await runCli(directory, 'console');
		const directStarted = performance.now();
		const direct = await scanDirectory(directory, { failOn: 'HIGH' });
		const directElapsedMs = performance.now() - directStarted;
		return {
			generatedFiles: fileCount,
			ignoredFiles,
			filesScanned: jsonOnce.filesScanned,
			findings: jsonOnce.findings,
			iterations,
			medianCliMs: median(measurements.map(item => item.elapsedMs)),
			medianScannerMs: median(measurements.map(item => item.scannerDurationMs)),
			filesPerSecond: Number((jsonOnce.filesScanned / (median(measurements.map(item => item.elapsedMs)) / 1000)).toFixed(2)),
			peakRssMb: jsonOnce.rssKb === null ? null : Number((Math.max(...measurements.map(item => item.rssKb ?? 0)) / 1024).toFixed(2)),
			jsonReportMs: Number((measurements[0].elapsedMs).toFixed(2)),
			sarifReportMs: Number(sarif.elapsedMs.toFixed(2)),
			consoleReportMs: Number(consoleReport.elapsedMs.toFixed(2)),
			jsonOutputBytes: jsonOnce.outputBytes,
			sarifOutputBytes: sarif.outputBytes,
			directCoreMs: Number(directElapsedMs.toFixed(2)),
			directCoreFiles: direct.filesScanned
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
async function pathologicalChecks(): Promise<Record<string, unknown>> {
	const directory = await mkdtemp(path.join(tmpdir(), 'compliance-pathological-'));
	try {
		await fs.mkdir(path.join(directory, 'deep', ...Array.from({ length: 8 }, (_, index) => `level-${index}`)), { recursive: true });
		await writeFile(path.join(directory, 'deep', ...Array.from({ length: 8 }, (_, index) => `level-${index}`), 'long.ts'), `${'x'.repeat(200_000)}\n`);
		await writeFile(path.join(directory, 'oversized.ts'), 'x'.repeat(1_048_577));
		const started = performance.now();
		const result = await scanDirectory(directory);
		return { elapsedMs: Number((performance.now() - started).toFixed(2)), filesScanned: result.filesScanned, skippedFiles: result.skippedFiles, findings: result.findings.length };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
const results = Object.fromEntries(await Promise.all(sizes.map(async size => [String(size), await measureSize(size)])));
console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: (await import('node:os')).cpus().length, iterations }, results, pathological: await pathologicalChecks(), disclaimer: 'Synthetic engineering measurements, not universal production performance claims.' }, null, 2));
