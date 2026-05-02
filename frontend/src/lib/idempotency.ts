export function createIdempotencyKey(action: string) {
  return `${action}:${crypto.randomUUID()}`;
}
