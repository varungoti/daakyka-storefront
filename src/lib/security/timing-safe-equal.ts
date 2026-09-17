import { timingSafeEqual } from "node:crypto";

/**
 * True when `a` and `b` are equal. Uses timingSafeEqual to avoid leaking
 * how many leading bytes matched via response timing; a length mismatch
 * (the only thing this doesn't hide) is already public information —
 * anyone can send a different-length guess and observe a fast rejection.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
