import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input: string | Buffer) {
  return createHash('sha256').update(input).digest('hex');
}

export function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
