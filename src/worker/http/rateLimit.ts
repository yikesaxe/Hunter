/**
 * Per-domain rate limiter. Enforces a minimum delay between requests to the
 * same domain. Defaults to 1000ms (1 req/sec).
 */

const lastRequestTime = new Map<string, number>();

const DEFAULT_DELAY_MS = 1000;

/** Per-domain delay overrides in milliseconds */
const domainDelays: Record<string, number> = {
  "www.leasebreak.com": 1200,
  "leasebreak.com": 1200,
};

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Wait until enough time has passed since the last request to this domain.
 * Call this BEFORE making a fetch to the given URL.
 */
export async function waitForRateLimit(url: string): Promise<void> {
  const domain = getDomain(url);
  const delay = domainDelays[domain] ?? DEFAULT_DELAY_MS;
  const last = lastRequestTime.get(domain) ?? 0;
  const elapsed = Date.now() - last;

  if (elapsed < delay) {
    const wait = delay - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  lastRequestTime.set(domain, Date.now());
}

/**
 * Set a custom delay for a domain.
 */
export function setDomainDelay(domain: string, delayMs: number): void {
  domainDelays[domain] = delayMs;
}
