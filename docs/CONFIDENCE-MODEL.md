# Confidence Model

- `HIGH`: a known provider format or well-defined logger/security operation matches.
- `MEDIUM`: a sensitive field and relevant operation are connected by a local heuristic.
- `LOW`: contextual or naming-based evidence with substantial ambiguity.

High-confidence rules are eligible for internal precision gates. Low-confidence rules should warn or remain opt-in by default.