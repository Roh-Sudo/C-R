export function healthCheck(): { status: 'ok' } {
  return { status: 'ok' };
}

export function buildGreeting(name: string): string {
  return `Hello, ${name}`;
}