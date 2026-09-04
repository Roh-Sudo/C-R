import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { can, verifySignature } from '../apps/api/src/index.js';

// These tests exercise security-critical helpers without starting a network listener.
describe('platform security helpers', () => {
  it('centralizes role permissions', () => {
    expect(can({ role: 'OWNER' }, ['OWNER', 'ADMIN'])).toBe(true);
    expect(can({ role: 'VIEWER' }, ['OWNER', 'ADMIN'])).toBe(false);
    expect(can(undefined, ['OWNER'])).toBe(false);
  });

  it('accepts only valid GitHub HMAC signatures', () => {
    const payload = '{"action":"push"}';
    const signature = 'sha256=' + createHmac('sha256', 'fake-webhook-secret').update(payload).digest('hex');
    expect(verifySignature(payload, signature, 'fake-webhook-secret')).toBe(true);
    expect(verifySignature(payload, signature, 'wrong-secret')).toBe(false);
    expect(verifySignature(payload, undefined, 'fake-webhook-secret')).toBe(false);
  });
});
