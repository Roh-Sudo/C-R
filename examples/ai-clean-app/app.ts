// Fictional safe AI demo. No real customer data.
// ai-governance: registered
import OpenAI from 'openai';

const client = new OpenAI({ model: process.env.AI_MODEL });
export async function answer(question: string): Promise<string> {
  const safeQuestion = question.slice(0, 500).replace(/[<>]/g, '');
  const result = await client.invoke(safeQuestion);
  return validateModelOutput(result);
}
function validateModelOutput(output: string): string {
  return output.slice(0, 1000);
}
