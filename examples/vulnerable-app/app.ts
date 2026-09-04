// ALL VALUES IN THIS DEMO ARE FAKE AND MUST NOT BE USED AS CREDENTIALS.
const fakeSsn = '123-45-6789';
const fakeEmail = 'demo.user@example.test';
const password = 'fake-password-only';
const apiKey = 'sk_test_1234567890abcdef';
const serviceUrl = 'http://internal-api.example.test';
const tlsOptions = { rejectUnauthorized: false };
const cors = { origin: '*' };

console.log(fakeSsn);
console.log(password);
console.log(fakeEmail);
logger.info(apiKey);

export { fakeSsn, fakeEmail, password, apiKey, serviceUrl, tlsOptions, cors };