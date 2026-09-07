import { describe, expect, it, vi } from 'vitest';
import { createAgentGate, type ToolPolicy } from '../packages/compliance-core/src/agent-gate.js';

const policy = (): ToolPolicy => ({ effect: 'read', maxCalls: 2, fields: { text: { maxLength: 200 } } });
function setup(overrides: Partial<ToolPolicy> = {}) {
  const run = vi.fn(async () => 'safe result');
  const gate = createAgentGate({ lookup: { policy: { ...policy(), ...overrides }, run } }, 2);
  return { gate, run };
}
describe('agent execution gate', () => {
  it('executes validated input and excludes payloads and outputs from audit', async () => {
    const { gate, run } = setup();
    expect((await gate.execute('lookup', '{"text":"ordinary support question"}')).ok).toBe(true);
    expect(run).toHaveBeenCalledWith({ text: 'ordinary support question' });
    expect(JSON.stringify(gate.audit())).not.toMatch(/ordinary|safe result/);
  });
  it.each(['sk-proj-fakeonly123456789012345678', 'AKIAFAKEONLY12345678', '123-45-6789', 'password=fake-demo-value', 'Bearer fake-demo-value', '-----BEGIN PRIVATE KEY-----'])('blocks sensitive input without exposing evidence: %s', async value => {
    const { gate, run } = setup();
    const result = await gate.execute('lookup', JSON.stringify({ text: value }));
    expect(result.event.reason).toBe('SENSITIVE_INPUT');
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify([result, gate.audit()])).not.toContain(value);
  });
  it.each(['How do I reset my password?', 'Explain bearer authentication', 'The token count is 100'])('permits likely false positives: %s', async text => {
    expect((await setup().gate.execute('lookup', JSON.stringify({ text }))).ok).toBe(true);
  });
  it.each(['{}', 'null', '[]', '{', '{"text":1}', '{"text":"ok","extra":"bad"}', '{"__proto__":"bad"}'])('rejects malformed or unexpected arguments: %s', async input => {
    const { gate, run } = setup();
    expect((await gate.execute('lookup', input)).event.reason).toBe('INVALID_INPUT');
    expect(run).not.toHaveBeenCalled();
  });
  it('denies unknown tools without echoing attacker identifiers', async () => {
    const { gate } = setup();
    const result = await gate.execute('password=fake-demo-value', '{}');
    expect(result.event).toMatchObject({ tool: 'unregistered', reason: 'UNKNOWN_TOOL' });
  });
  it('requires trusted explicit permission for writes', async () => {
    const blocked = setup({ effect: 'write' });
    expect((await blocked.gate.execute('lookup', '{"text":"ok"}')).event.reason).toBe('EFFECT_NOT_ALLOWED');
    expect(blocked.run).not.toHaveBeenCalled();
    expect((await setup({ effect: 'write', allowWrite: true }).gate.execute('lookup', '{"text":"ok"}')).ok).toBe(true);
  });
  it('uses exact allowed values to constrain destinations', async () => {
    const { gate } = setup({ fields: { text: { maxLength: 200, allowedValues: ['https://example.test'] } } });
    expect((await gate.execute('lookup', '{"text":"https://example.test.attacker.test"}')).ok).toBe(false);
    expect((await gate.execute('lookup', '{"text":"https://example.test"}')).ok).toBe(true);
  });
  it('reserves budgets before concurrent execution', async () => {
    const { gate, run } = setup({ maxCalls: 1 });
    const results = await Promise.all(Array.from({ length: 8 }, () => gate.execute('lookup', '{"text":"ok"}')));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('enforces a shared budget across tools', async () => {
    const run = vi.fn(() => 'ok');
    const gate = createAgentGate({ one: { policy: policy(), run }, two: { policy: policy(), run } }, 1);
    await gate.execute('one', '{"text":"ok"}');
    expect((await gate.execute('two', '{"text":"ok"}')).event.reason).toBe('BUDGET_EXHAUSTED');
  });
  it('hides exceptions and does not refund failed calls', async () => {
    const gate = createAgentGate({ lookup: { policy: policy(), run: () => { throw new Error('password=fake-demo-value'); } } }, 1);
    expect((await gate.execute('lookup', '{"text":"ok"}')).event.reason).toBe('TOOL_FAILED');
    expect((await gate.execute('lookup', '{"text":"ok"}')).event.reason).toBe('BUDGET_EXHAUSTED');
    expect(JSON.stringify(gate.audit())).not.toContain('fake-demo-value');
  });
  it('snapshots policy and returns isolated audit events', async () => {
    const original = policy();
    original.fields.text.allowedValues = ['ok'];
    const gate = createAgentGate({ lookup: { policy: original, run: () => 'ok' } }, 1);
    original.fields.text.allowedValues = ['bad'];
    const result = await gate.execute('lookup', '{"text":"ok"}');
    result.event.reason = 'TOOL_FAILED';
    gate.audit()[0].reason = 'TOOL_FAILED';
    expect(gate.audit()[0].reason).toBe('ALLOWED');
  });
});
