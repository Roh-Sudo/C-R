# Rule Changelog

| Rule | Version | Change | Expected impact |
| --- | --- | --- | --- |
| SEC-001 | 1 | Initial provider-style secret detection | Detect obvious hardcoded provider secrets. |
| AI-001..010 | 1 | Initial AI Governance-as-Code checks | Identify deterministic AI integration and data-flow signals for review. |

Rule versions should be persisted with findings when the database adapter is upgraded. Historical findings must remain attributable to the implementation that generated them.
