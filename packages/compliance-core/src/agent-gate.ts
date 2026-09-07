/** Local, opt-in enforcement at a trusted tool dispatch boundary. */
export type GateReason = 'ALLOWED' | 'UNKNOWN_TOOL' | 'INVALID_INPUT' | 'SENSITIVE_INPUT' | 'EFFECT_NOT_ALLOWED' | 'BUDGET_EXHAUSTED' | 'TOOL_FAILED';
export type FieldPolicy = { maxLength: number; allowedValues?: readonly string[] };
export type ToolPolicy = {
  effect: 'read' | 'write';
  allowWrite?: boolean;
  maxCalls: number;
  fields: Readonly<Record<string, FieldPolicy>>;
};
export type GateEvent = { sequence: number; tool: string; reason: GateReason };
export type GateResult<T> = { ok: true; value: T; event: GateEvent } | { ok: false; event: GateEvent };
export type GatedTool<T> = { policy: ToolPolicy; run: (args: Readonly<Record<string, string>>) => T | Promise<T> };

// Conservative heuristics, not a complete DLP detector. Never include matches in events.
const sensitive = /\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|\d{3}-\d{2}-\d{4})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+|(?:^|\bAuthorization\s*:\s*)Bearer\s+\S+/i;

/** Create one gate per trusted run. Never let the model create policies or reset budgets. */
export function createAgentGate<T>(tools: Readonly<Record<string, GatedTool<T>>>, maxTotalCalls: number) {
  if (!Number.isSafeInteger(maxTotalCalls) || maxTotalCalls < 1) throw new Error('Invalid total call budget');
  const registry = new Map<string, GatedTool<T>>();
  for (const [id, tool] of Object.entries(tools)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(id)) throw new Error('Invalid tool identifier');
    const policy = structuredClone(tool.policy);
    if (!['read', 'write'].includes(policy.effect) || !Number.isSafeInteger(policy.maxCalls) || policy.maxCalls < 1) throw new Error('Invalid tool policy');
    for (const field of Object.values(policy.fields)) {
      if (!Number.isSafeInteger(field.maxLength) || field.maxLength < 1 || (field.allowedValues && (!Array.isArray(field.allowedValues) || field.allowedValues.some(value => typeof value !== 'string')))) throw new Error('Invalid field policy');
    }
    registry.set(id, { policy, run: tool.run });
  }
  let total = 0;
  let sequence = 0;
  const counts = new Map<string, number>();
  const events: GateEvent[] = [];
  function record(tool: string, reason: GateReason): GateEvent {
    const event = { sequence: ++sequence, tool, reason };
    events.push(event);
    return { ...event };
  }
  return {
    audit: (): GateEvent[] => events.map(event => ({ ...event })),
    async execute(toolId: string, argumentsJson: string): Promise<GateResult<T>> {
      const tool = registry.get(toolId);
      // Unknown identifiers may themselves contain secrets; never echo them.
      const label = tool ? toolId : 'unregistered';
      const deny = (reason: GateReason): GateResult<T> => ({ ok: false, event: record(label, reason) });
      if (!tool) return deny('UNKNOWN_TOOL');
      if (tool.policy.effect === 'write' && tool.policy.allowWrite !== true) return deny('EFFECT_NOT_ALLOWED');
      if (typeof argumentsJson !== 'string' || argumentsJson.length > 16_384) return deny('INVALID_INPUT');
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { return deny('INVALID_INPUT'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) return deny('INVALID_INPUT');
      const entries = Object.entries(args);
      if (entries.length !== Object.keys(tool.policy.fields).length) return deny('INVALID_INPUT');
      for (const [key, value] of entries) {
        if (!Object.hasOwn(tool.policy.fields, key)) return deny('INVALID_INPUT');
        const field = tool.policy.fields[key];
        if (typeof value !== 'string' || value.length > field.maxLength) return deny('INVALID_INPUT');
        if (sensitive.test(value)) return deny('SENSITIVE_INPUT');
        if (field.allowedValues && !field.allowedValues.includes(value)) return deny('INVALID_INPUT');
      }
      const used = counts.get(toolId) ?? 0;
      if (total >= maxTotalCalls || used >= tool.policy.maxCalls) return deny('BUDGET_EXHAUSTED');
      // Reserve before awaiting: concurrent requests cannot overspend the budget.
      total++;
      counts.set(toolId, used + 1);
      try {
        const value = await tool.run(Object.freeze(args as Record<string, string>));
        return { ok: true, value, event: record(label, 'ALLOWED') };
      } catch {
        // A failed tool may have already caused an effect. Keep its budget spent.
        return deny('TOOL_FAILED');
      }
    }
  };
}
