import { waitForRateLimit } from "./rateLimit";

const USER_AGENT =
  "Mozilla/5.0 (compatible; HunterBot/1.0; +https://github.com/yikesaxe/Hunter)";

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export interface FetchPolicyOptions {
  /** Request timeout in ms (default 12000) */
  timeoutMs?: number;
  /** Max retries (default 3) */
  maxRetries?: number;
  /** Skip rate limiting (e.g. for file:// URLs) */
  skipRateLimit?: boolean;
  /** Extra headers to merge in */
  headers?: Record<string, string>;
}

export interface PolicyFetchResult {
  httpStatus: number;
  content: string;
  finalUrl: string;
}

/**
 * Fetch a URL with:
 * - Configurable timeout (default 12s)
 * - Retries (default 3) with exponential backoff + jitter
 * - Consistent User-Agent header
 * - Per-domain rate limiting (unless skipRateLimit)
 *
 * Returns { httpStatus, content, finalUrl }.
 */
export async function fetchWithPolicy(
  url: string,
  opts: FetchPolicyOptions = {}
): Promise<PolicyFetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
    skipRateLimit = false,
    headers = {},
  } = opts;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter
      const backoff =
        BASE_BACKOFF_MS * Math.pow(2, attempt - 1) +
        Math.random() * BASE_BACKOFF_MS;
      console.log(
        `[fetchWithPolicy] Retry ${attempt}/${maxRetries} for ${url} (waiting ${Math.round(backoff)}ms)`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    // Rate limit (wait for domain cooldown)
    if (!skipRateLimit) {
      await waitForRateLimit(url);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          ...headers,
        },
        redirect: "follow",
      });

      clearTimeout(timeout);

      const content = await response.text();

      return {
        httpStatus: response.status,
        content,
        finalUrl: response.url || url,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on abort (timeout) if it's the last attempt
      if (lastError.name === "AbortError") {
        console.warn(
          `[fetchWithPolicy] Timeout after ${timeoutMs}ms for ${url}`
        );
      } else {
        console.warn(
          `[fetchWithPolicy] Attempt ${attempt + 1} failed for ${url}: ${lastError.message}`
        );
      }
    }
  }

  throw new Error(
    `[fetchWithPolicy] All ${maxRetries + 1} attempts failed for ${url}: ${lastError?.message}`
  );
}
