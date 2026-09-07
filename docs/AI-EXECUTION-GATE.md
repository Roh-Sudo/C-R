# AI execution gate: product hypothesis and technical architecture

## Problem and initial customer

An AI support agent reads a customer ticket containing malicious instructions. It proposes sending customer data to a new destination. A source scanner can identify suspicious integration code, but cannot decide whether this particular tool invocation is permitted at runtime.

The initial customer hypothesis is a small engineering team moving a support or internal-operations agent from read-only answers to tools with business effects. The buyer hypothesis is the engineering or security lead responsible for approving that launch. Their pain is defining and demonstrating the exact actions an agent can take without manually reviewing every action.

OWASP's [Excessive Agency guidance, 2025 edition](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) identifies excessive functionality, permissions, and autonomy as root causes and recommends limiting tool functionality and authorization. This supports the technical problem; it does not establish willingness to pay or market differentiation.

## Proposed solution

Extend the existing local scanner with a deterministic execution gate. The scanner identifies integrations during development. The gate evaluates each proposed tool call against application-owned policy during execution. The model proposes actions; trusted application code owns permission and dispatch.

```text
Untrusted model / retrieved text
             |
      tool ID + JSON arguments
             |
       Local execution gate
       1. registered tool?
       2. effect permitted?
       3. exact argument shape and values?
       4. sensitive input signal?
       5. remaining call budget?
             |
       Trusted tool handler ----> Business system
             |
       Metadata-only local audit
```

## Working prototype

`packages/compliance-core/src/agent-gate.ts` exports `createAgentGate`. It is an additive library module; existing scan behavior and platform endpoints are unchanged. The runnable demonstration is `apps/agent-gate-demo/src/index.ts`.

```bash
npm run build
node dist/apps/agent-gate-demo/src/index.js
npx vitest run tests/agent-gate.test.ts
```

The demo performs one fake ticket lookup, blocks a repeated lookup after its budget is consumed, blocks a write without trusted permission, and rejects an unregistered shell tool. It uses no model, network, real credentials, or external effects.

The gate accepts a trusted registry of handlers and snapshots their policies. Arguments are JSON objects with required string fields only. Unknown fields, missing fields, non-string values, oversized fields, and bodies over 16,384 JavaScript code units are rejected. Exact allowed values support a small set of approved destinations or resource identifiers; they do not perform URL normalization. Write handlers require explicit `allowWrite: true`. A per-tool and shared budget is reserved synchronously before awaiting execution. Failed executions remain charged because a handler may have already performed an effect.

Each completed request produces a sequence number, a registered tool identifier (or `unregistered`), and a fixed reason code. Audit entries contain no arguments, results, or error messages. Sequence numbers reflect completion order, not invocation order. Successful results are returned to the caller and must be handled according to the application's data policy.

## Trust boundary and failure modes

This is an opt-in in-process library, not a sandbox. All relevant tool invocations must route through it. The agent must not control registry creation, policy values, budget resets, handler code, or the application's credentials. Labels such as `read` are declarations by trusted developers; the library cannot verify that a handler really is read-only.

Sensitive-input checks recognize selected credential-shaped strings, private-key markers, SSN-shaped values, and explicit credential assignments. They are heuristics with false positives and false negatives. They do not detect all personal data, encoded secrets, split credentials, or semantic prompt injection. Passing the check is not proof that data is safe. Audit tool identifiers must be developer-chosen static names, never secret-bearing values.

Destination allowlists constrain arguments only. Trusted network handlers must separately enforce redirect rules, resolved IP restrictions, authorization, and response handling. Exact string equality alone does not prevent SSRF or DNS rebinding. The prototype neither inspects outputs nor limits output size.

Budgets and audit entries live in memory per gate instance. Restarting or creating another gate resets them. Requests rejected before dispatch do not spend tool budgets; the host must apply request rate limits and manage gate lifetime to bound audit memory. There is no durable audit, distributed budget, timeout cancellation, idempotency, human approval workflow, or cross-process enforcement yet. Tool failure does not guarantee rollback, and a hung handler stays pending.

## Production architecture and delivery sequence

1. **Pilot SDK integration:** wrap a single application's tool dispatcher; keep credentials exclusively in trusted handlers. Supply explicit policies for each tool and collect sanitized decision metadata. Treat adoption as instrumentation plus enforcement work, not automatic protection from installing a package.
2. **Durable execution service:** move credentials and handlers behind an authenticated dispatcher. Bind policy and budgets to organization, user, run, and policy version. Use atomic database reservations and idempotency keys. Persist intent before execution and completion afterward; reconcile uncertain effects rather than blindly retrying.
3. **Human approval for selected effects:** store a pending action with canonical arguments, their digest, principal, policy version, expiration, and single-use approval. Recheck authorization at execution. A model-supplied approval flag is never sufficient.
4. **Scanner-to-runtime relationship:** link discovered integrations to registered tools, owners, and policy versions in the existing platform. Show uncovered integrations as review items; static discovery cannot prove dispatch coverage.
5. **Operational hardening:** introduce output handling policy, bounded audit retention, revocation, handler isolation, network restrictions, per-tenant quotas, and recovery testing before customer production use.

The existing PostgreSQL platform can eventually hold policy versions and sanitized decision records. Keep the first SDK independent of platform availability. Define outage behavior explicitly before a remote dispatcher is introduced: privileged actions should fail closed when authorization cannot be verified.

## Validation and business decision

Interview five teams that already operate tool-using agents. Ask for their most recent blocked rollout or incident, current permissions implementation, review burden, and budget owner. Do not infer demand from general concern about AI safety.

Run a two-week pilot on one workflow. Measure integration effort, added p50/p95 latency, blocked seeded unauthorized actions, false blocks on labeled legitimate calls, percentage of tool dispatch paths covered, and operator review time. Track decisions without retaining prompts or customer content. Candidate success criteria, not measured claims: every seeded out-of-policy action blocked at the integrated boundary, less than 1% false blocks on the team's reviewed legitimate set, and integration within one engineer-day.

Compare the same workflow against existing application authorization and the agent framework's native controls. The potential differentiator is linking repository findings to runtime enforcement evidence in a local-first workflow. If native controls solve the customer's problem adequately, focus this project on evidence and coverage instead of creating a second policy engine. Seek a paid pilot commitment before expanding into a generalized gateway.

## Verification scope

Focused tests cover normal execution, common benign text, fake sensitive input, metadata privacy, invalid input, unknown tools, write permission, exact allowed values, concurrent budget reservation, shared budgets, exceptions, and policy/audit isolation. These tests demonstrate the implemented boundary; they do not establish comprehensive prompt-injection resistance or regulatory compliance.
