# False-Positive Validation

This is synthetic benchmark validation, not a claim of universal real-world scanner accuracy.

## Corpus

`benchmarks/fixtures/false-positive-clean` contains four synthetic files covering:

- UUIDs, SHA-style hashes, package-lock integrity values, numeric IDs, and generated/minified code
- Placeholder API keys, dummy/test credentials, example bearer tokens, and mock data
- Documentation comments and README-style provider/insecure-pattern examples
- Safe logger messages and public `example.*` email addresses
- Provider names in ordinary strings and comments without an AI import
- Localhost HTTP, development debug mode, and development wildcard CORS

The scanner does not scan README files or unsupported extensions; those examples remain documented in the corpus comments and are not used to inflate the measurement.

## Baseline

The initial scan covered 3 files and produced 7 unexpected findings:

| Measure | Before |
|---|---:|
| Total findings | 7 |
| Blocking findings (HIGH/CRITICAL) | 4 |
| Warning findings (MEDIUM/LOW) | 3 |
| Confirmed false positives | 7 |
| Blocking false positives | 4 |
| Duplicate findings in clean corpus | 0 |
| AI components discovered | 1 |

The blocking false positives were placeholder bearer/password/API-key values. The warning false positives were public example email fields and a safe minified logger line that contained the word `Request`. The provider-name string was incorrectly discovered as an AI component.

## Fixes

- Added narrow placeholder recognition for `SEC-004`, `SEC-006`, and `CFG-005`; real-looking values still use the existing detectors.
- Limited `PII-004` to its declared configuration formats and ignored synthetic `example.*`/localhost public addresses.
- Required import, SDK, or constructor evidence for AI component discovery; ordinary provider-name strings no longer create inventory entries.
- Required a code-like prompt/response value for `AI-003`, preventing matches inside safe message text.

No rules were downgraded because all rules are currently `BETA`; no `STABLE` blocking rules exist in the registry.

## After

The final scan covered 4 files and produced only the two intentional development-configuration review signals:

| Measure | After |
|---|---:|
| Total findings | 2 |
| Blocking findings (HIGH/CRITICAL) | 0 |
| Warning findings (MEDIUM/LOW) | 2 |
| Confirmed false positives | 0 |
| Blocking false positives | 0 |
| Duplicate findings in clean corpus | 0 |
| AI components discovered | 0 |

Remaining findings are `CFG-002` for wildcard CORS and `CFG-003` for `debug: true` in an explicitly development-named fixture. They are `NEEDS_REVIEW` development-configuration signals, not blocking findings.

## Positive coverage and limitations

The stress test retains positive detection coverage for a provider-style API key, sensitive AI input, AI logging, and an OpenAI import/governance signal. The existing scanner and vulnerable-fixture tests remain the recall guard. This corpus does not establish universal accuracy, and configuration context beyond explicit file naming remains a known limitation.
