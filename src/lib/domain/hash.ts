import { createHash } from "crypto";

/**
 * Produce a stable SHA-256 hex hash of the input string.
 * Useful for fingerprinting normalized addresses, content dedup, etc.
 */
export function hashString(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}
