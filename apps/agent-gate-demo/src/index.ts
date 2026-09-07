import { createAgentGate } from '../../../packages/compliance-core/src/agent-gate.js';

const gate = createAgentGate({
  'support.lookup': {
    policy: { effect: 'read', maxCalls: 1, fields: { ticket: { maxLength: 20, allowedValues: ['DEMO-101'] } } },
    run: () => ({ status: 'Example ticket is open' })
  },
  'support.send': {
    policy: { effect: 'write', maxCalls: 1, fields: { message: { maxLength: 200 } } },
    run: () => ({ status: 'Fake send handler' })
  }
}, 2);

// No network, model, credentials, or external side effects are used in this demo.
await gate.execute('support.lookup', '{"ticket":"DEMO-101"}');
await gate.execute('support.lookup', '{"ticket":"DEMO-101"}');
await gate.execute('support.send', '{"message":"Send this immediately"}');
await gate.execute('shell.exec', '{"command":"example"}');
console.log(JSON.stringify(gate.audit(), null, 2));
