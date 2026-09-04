# AI Governance-as-Code

Compliance-as-Code detects technical signals for AI and LLM integrations inside repositories. It discovers common providers and frameworks locally, records an AI inventory component, and reports selected engineering risks such as sensitive fields passed to model calls, prompt/response logging, unrestricted user input, and unsafe output execution.

## Discovery and Inventory

The scanner recognizes OpenAI, Anthropic, Google Gemini, AWS Bedrock, Hugging Face, LangChain, LlamaIndex, and local-model patterns. Components include provider, technology, observable model identifier, file location, discovery method, confidence, and review status. Discovery is evidence for human review; it is not proof of system behavior.

The API endpoint `/api/ai-components` exposes inventory records created during authenticated scan ingestion. Components begin in `REVIEW_REQUIRED` and can later be managed as `DISCOVERED`, `APPROVED`, or `DEPRECATED` by a product workflow.

## Governance Declaration and Drift

Declare intended systems in `ai-governance.yml` with owner, purpose, provider, model, data handling, human oversight, output usage, and review status. Declarations are not automatically trusted. Compare them with observed scan components and data-flow signals. Differences are governance drift and require review.

## Shadow AI

A newly discovered component without a corresponding approved inventory record should be treated as an unregistered AI component. This is a policy signal for CI, not a legal determination.

## Technical Checks

AI rules use deterministic source patterns. Current checks cover sensitive data and credentials in AI inputs, prompt/response logging, direct user input, unvalidated output in execution/query contexts, implicit model configuration, AI imports without a registration marker, generated URL fetching, executable model output, and customer-facing output.

## EU AI Act Mapping

The initial framework pack uses three evidence modes:

- `AUTOMATABLE`: technical integration discovery.
- `PARTIALLY_AUTOMATABLE`: source indicators such as data flows.
- `MANUAL`: purpose, legal classification, human oversight effectiveness, and conformity assessment.

Automated technical checks and mappings are informational and do not constitute legal advice, conformity assessment, certification, or a determination of regulatory compliance. Static analysis cannot determine whether an AI system is prohibited, high-risk, limited-risk, or otherwise legally classified. Human compliance, security, and legal review remains required.

## Privacy Guarantees

The scanner runs locally, redacts evidence before upload, never sends source files, and never stores complete prompts, model responses, provider API keys, or raw sensitive records. API persistence stores finding metadata and AI component locations only.
