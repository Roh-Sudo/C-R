# MVP Performance Benchmark

This report contains synthetic engineering measurements, not universal production performance claims.

## Environment

- OS: Linux container
- Node.js: v24.14.0
- Architecture: x64
- CPUs visible: 2
- Iterations: 3 per repository size
- Measurement: normal CLI process, including startup, discovery, analysis, and report generation
- Memory: peak child `VmRSS` sampled from `/proc`
- Ignore policy: existing scanner defaults (`node_modules`, `.git`, `dist`, `build`, `coverage`, `vendor`)

The benchmark generated deterministic mixtures of TypeScript, JavaScript, JSON, YAML, Python, Java, and properties files, nested directories, synthetic findings, clean values, lockfile hashes, UUIDs, and ignored generated files.

## Results

| Size | Generated | Ignored | Scanned | Findings | Median CLI ms | Median scanner ms | Files/sec | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| SMALL | 100 | 5 | 95 | 5 | 169.58 | 96 | 560.22 | 60.15 MB |
| MEDIUM | 1,000 | 50 | 950 | 56 | 618.50 | 524 | 1,535.97 | 62.59 MB |
| LARGE | 10,000 | 500 | 9,500 | 559 | 3,472.72 | 3,427 | 2,735.61 | 68.73 MB |

The CLI completed all 9 measurement runs without crashes, unhandled rejections, or out-of-memory behavior. The expected scan-threshold exit code was accepted by the harness because synthetic finding files intentionally produce findings.

## Report overhead

Representative CLI timings from each size were:

| Size | JSON | SARIF | Console |
|---|---:|---:|---:|
| 100 | 169.58 ms | 166.86 ms | 137.50 ms |
| 1,000 | 610.01 ms | 507.35 ms | 517.19 ms |
| 10,000 | 3,725.72 ms | 3,189.92 ms | 3,239.03 ms |

JSON and SARIF generation did not introduce pathological overhead. The output sizes at 10,000 generated files were approximately 493 KB JSON and 346 KB SARIF.

## Ignore and pathological checks

The benchmark generated 5%, 50%, and 500 files under existing ignored directories; those files were not scanned. No new ignore rules were added.

A bounded pathological fixture included an eight-level directory, a 200 KB long line, and a 1 MiB-plus file. It completed in 11.47 ms, scanned the normal file, skipped the oversized file deterministically, and produced no findings. The existing maximum-file-size behavior remains visible through `skippedFiles`.

## Bottlenecks

No serious MVP bottleneck was demonstrated. The dominant cost at SMALL size is process startup and rule loading. At MEDIUM and LARGE sizes, file discovery and rule execution dominate, while throughput remains stable and peak RSS grows by less than 9 MB from SMALL to LARGE in this synthetic run.

No optimization was made because the measurements did not show a pilot-blocking defect. The benchmark harness itself was extended to cover the requested sizes, report modes, ignores, memory sampling, and pathological behavior.

## Correctness and limitations

The existing scanner core tests, false-positive stress tests, clean scan, and vulnerable scan were run after the benchmark changes. The benchmark uses synthetic files and bounded local measurements; it does not establish production performance across different disks, CPUs, repositories, rule configurations, or CI runners.

## MVP status

**PASS_WITH_LIMITATIONS**

The scanner completed the 10,000-file synthetic workload without instability and normal CI-style scans include CLI startup and report generation. Production-scale performance may vary, and the current benchmark does not measure concurrent scans or network/API upload latency.
