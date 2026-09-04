// Fictional AI demo. All data is fake.
import OpenAI from 'openai';

const client = new OpenAI();
const customer = { ssn: '123-45-6789', email: 'demo@example.test' };
const userInput = request.body.message;
const prompt = `Help this customer: ${customer.ssn} ${userInput}`;
const response = client.invoke(customer.ssn);
console.log(prompt);
console.log(response);
eval(response);
