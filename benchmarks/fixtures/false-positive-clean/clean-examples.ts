// Synthetic clean corpus: these examples are intentionally non-production values.
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const checksum = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const apiKey = 'YOUR_API_KEY';
const password = 'test-secret';
const supportEmail = 'support@example.com';
const user = { profile: { email: 'developer@example.com' }, id: 42 };
const mockToken = 'example-token';
const safeMessage = 'Request completed';
const publicUrl = 'http://localhost:3000/status';
const docs = 'Authorization: Bearer EXAMPLE_TOKEN';
const aiDocumentation = 'OpenAI, Anthropic, and Gemini are supported providers.';
console.log(safeMessage);

// Never use password="secret" in production.
// Example: Authorization: Bearer EXAMPLE_TOKEN
export { requestId, checksum, apiKey, password, supportEmail, user, mockToken, publicUrl, docs, aiDocumentation };
