# Severity Model

- `CRITICAL`: likely credential exposure or direct execution/data-loss impact requiring immediate containment.
- `HIGH`: material security, privacy, or governance risk that should generally block a configured CI threshold.
- `MEDIUM`: meaningful risk requiring review, but context may materially change impact.
- `LOW`: contextual signal or low-impact hygiene issue.

Severity describes potential impact. It is independent from confidence, which describes detector certainty. These are engineering classifications, not legal conclusions.