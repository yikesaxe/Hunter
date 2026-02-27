// scraperV2/src/fetchPage.ts
// The fetching layer: HTTP-first with rebrowser-playwright fallback, rate limiting, block detection.
// Tier 1: rebrowser-playwright (CDP leak patches) + headed mode + human-like behavior + CAPTCHA handling
// Tier 2: Firecrawl fallback for the hardest sites

// rebrowser-playwright re-exports playwright-core; TS may not see 'chromium' from the re-export
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("rebrowser-playwright") as { chromium: import("playwright-core").BrowserType };
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// Ensure debug + sessions dirs exist
const DEBUG_DIR = join(process.cwd(), "debug");
const SESSIONS_DIR = join(process.cwd(), "sessions");
if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

// ==========================================================================
// User-Agent rotation
// ==========================================================================

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==========================================================================
// Debug: dump blocked responses to disk for inspection
// ==========================================================================

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function dumpDebug(
  url: string,
  html: string,
  statusCode: number,
  method: string,
  responseHeaders?: Record<string, string>
) {
  const domain = getDomain(url);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${domain}_${statusCode}_${method}_${timestamp}`;

  const htmlPath = join(DEBUG_DIR, `${filename}.html`);
  writeFileSync(htmlPath, html);

  const metaPath = join(DEBUG_DIR, `${filename}.json`);
  writeFileSync(metaPath, JSON.stringify({
    url, statusCode, method,
    htmlLength: html.length,
    timestamp: new Date().toISOString(),
    responseHeaders: responseHeaders || {},
    htmlSnippet: html.slice(0, 1000),
  }, null, 2));

  console.log(`  [debug] Saved blocked response to ${htmlPath}`);
}

// ==========================================================================
// Block detection
// ==========================================================================

const BLOCKED_KEYWORDS = [
  "captcha", "access denied", "please verify", "are you a robot",
  "cloudflare", "challenge-platform", "just a moment", "checking your browser",
  "performing security verification",
  "access to this page has been denied",
  "px-captcha",
  "perimeterx",
];

const THIN_PAGE_THRESHOLD = 500;

export function isBlockedOrThin(html: string, statusCode: number): { blocked: boolean; reason: string } {
  if (statusCode === 403) return { blocked: true, reason: "403 Forbidden" };
  if (statusCode === 429) return { blocked: true, reason: "429 Too Many Requests" };
  if (html.length < THIN_PAGE_THRESHOLD) return { blocked: true, reason: `Thin page (${html.length} chars)` };

  const visibleText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    if (visibleText.includes(keyword)) {
      return { blocked: true, reason: `Visible text contains "${keyword}"` };
    }
  }

  return { blocked: false, reason: "OK" };
}

// ==========================================================================
// Rate limiting
// ==========================================================================

const lastRequestTime = new Map<string, number>();
const lastFlareSolverrTime = new Map<string, number>();
const DEFAULT_DELAY_MS = 1500;
const FLARESOLVERR_DELAY_MS = 800; // Small delay between FlareSolverr calls to avoid overwhelming it

const domainDelays: Record<string, number> = {
  "www.leasebreak.com": 2000,  "leasebreak.com": 2000,
  "streeteasy.com": 2500,      "www.streeteasy.com": 2500,
  "www.renthop.com": 2000,     "renthop.com": 2000,
  "www.zillow.com": 2500,      "zillow.com": 2500,
  "www.apartments.com": 2000,  "apartments.com": 2000,
};

async function waitForRateLimit(url: string): Promise<void> {
  const domain = getDomain(url);
  const delay = domainDelays[domain] ?? DEFAULT_DELAY_MS;
  const jitter = Math.random() * delay * 0.25;
  const totalDelay = delay + jitter;
  const last = lastRequestTime.get(domain) ?? 0;
  const elapsed = Date.now() - last;

  if (elapsed < totalDelay) {
    const waitMs = Math.round(totalDelay - elapsed);
    console.log(`  [rate limit] Waiting ${waitMs}ms before hitting ${domain}...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastRequestTime.set(domain, Date.now());
}

// ==========================================================================
// HTTP fetch (with rotating User-Agent + cookie jar)
// ==========================================================================

const cookieJar = new Map<string, string>();

function getCookiesForDomain(url: string): string {
  return cookieJar.get(getDomain(url)) || "";
}

function storeCookies(url: string, headers: Headers) {
  const domain = getDomain(url);
  const setCookies = headers.getSetCookie?.() || [];
  if (setCookies.length === 0) return;

  // Merge into a name→value map to prevent unbounded growth (avoids Cloudflare 400)
  const cookieMap = new Map<string, string>();
  const existing = cookieJar.get(domain) || "";
  if (existing) {
    for (const pair of existing.split("; ")) {
      const idx = pair.indexOf("=");
      if (idx > 0) cookieMap.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  for (const raw of setCookies) {
    const kv = raw.split(";")[0].trim();
    const idx = kv.indexOf("=");
    if (idx > 0) cookieMap.set(kv.slice(0, idx), kv.slice(idx + 1));
  }
  cookieJar.set(domain, [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
  console.log(`  [cookies] Stored ${setCookies.length} cookie(s) for ${domain} (total: ${cookieMap.size})`);
}

async function httpFetch(url: string): Promise<{
  html: string;
  statusCode: number;
  finalUrl: string;
  responseHeaders: Record<string, string>;
}> {
  await waitForRateLimit(url);
  const ua = randomUserAgent();
  const cookies = getCookiesForDomain(url);

  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (cookies) headers["Cookie"] = cookies;

  const response = await fetch(url, { headers });
  storeCookies(url, response.headers);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key] = value; });

  return {
    html: await response.text(),
    statusCode: response.status,
    finalUrl: response.url,
    responseHeaders,
  };
}

// ==========================================================================
// rebrowser-playwright render (Tier 1) -- headed/headless mode + CDP patches + session persistence
// Set SCRAPER_HEADLESS=true for server deployments (no display available).
// ==========================================================================

const HEADLESS = process.env.SCRAPER_HEADLESS === "true";

function getSessionPath(domain: string): string {
  return join(SESSIONS_DIR, `${domain}.json`);
}

async function renderPage(url: string, proxyUrl?: string): Promise<{
  html: string;
  statusCode: number;
  finalUrl: string;
  responseHeaders: Record<string, string>;
}> {
  await waitForRateLimit(url);

  const ua = randomUserAgent();
  const viewport = randomViewport();
  const domain = getDomain(url);

  console.log(`  [rebrowser] Launching Chrome HEADED (UA: ...${ua.slice(-30)}, viewport: ${viewport.width}x${viewport.height})`);

  // Anti-detection args (undetected-chromedriver / stealth style): hide automation flags
  const launchOptions: Record<string, unknown> = {
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-size=1920,1080",
      "--disable-automation",
      "--use-mock-keychain",
    ],
  };

  if (proxyUrl) {
    try {
      const parsed = new URL(proxyUrl);
      launchOptions.proxy = {
        server: `${parsed.protocol}//${parsed.host}`,
        username: parsed.username || undefined,
        password: parsed.password || undefined,
      };
      console.log(`  [proxy] Using proxy: ${parsed.protocol}//${parsed.host}`);
    } catch {
      launchOptions.proxy = { server: proxyUrl };
    }
  }

  const browser = await chromium.launch(launchOptions);

  const sessionPath = getSessionPath(domain);
  const contextOptions: Record<string, unknown> = {
    userAgent: ua,
    viewport,
    timezoneId: "America/New_York",
    locale: "en-US",
    permissions: ["geolocation"],
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    colorScheme: "light",
    ignoreHTTPSErrors: true,
  };

  if (existsSync(sessionPath)) {
    console.log(`  [session] Loading saved session for ${domain}`);
    contextOptions.storageState = sessionPath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Stealth: hide navigator.webdriver before any navigation (undetected-chromedriver / playwright-stealth fix)
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
        configurable: true,
        enumerable: true,
      });
    } catch {
      try {
        delete (navigator as unknown as { webdriver?: boolean }).webdriver;
      } catch {}
    }
  });

  const responseHeaders: Record<string, string> = {};
  page.on("response", (resp) => {
    if (resp.url() === url || resp.url() === url + "/") {
      Object.assign(responseHeaders, resp.headers());
    }
  });

  // Block heavy resources to speed things up
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "font", "media"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    console.log("  [rebrowser] Navigating...");

    let response;
    try {
      response = await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    } catch {
      console.log("  [rebrowser] networkidle timed out, trying domcontentloaded...");
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch {
        console.log("  [rebrowser] domcontentloaded also timed out, grabbing whatever we have...");
      }
      await page.waitForTimeout(3000);
    }

    if (response && Object.keys(responseHeaders).length === 0) {
      Object.assign(responseHeaders, response.headers());
    }

    // Detect and solve PerimeterX "press and hold" CAPTCHA
    await randomDelay(1000, 2000);
    const pxCaptcha = await page.$('#px-captcha, [id*="px-captcha"], .px-captcha-container');
    if (pxCaptcha) {
      console.log("  [rebrowser] PerimeterX CAPTCHA detected -- press and hold...");
      await page.waitForTimeout(2000);

      const captchaButton = await page.$('#px-captcha') || pxCaptcha;
      const box = await captchaButton.boundingBox();

      if (box) {
        const targetX = box.x + box.width / 2;
        const targetY = box.y + box.height / 2;

        await page.mouse.move(200 + Math.random() * 300, 200 + Math.random() * 200);
        await randomDelay(100, 300);
        await page.mouse.move(targetX + (Math.random() * 6 - 3), targetY + (Math.random() * 6 - 3), { steps: 20 + Math.floor(Math.random() * 15) });
        await randomDelay(300, 700);

        const holdTime = 7000 + Math.random() * 4000;
        console.log(`  [rebrowser] Holding for ${Math.round(holdTime)}ms with micro-movements...`);
        await page.mouse.down();

        const holdStart = Date.now();
        while (Date.now() - holdStart < holdTime) {
          await page.mouse.move(targetX + (Math.random() * 4 - 2), targetY + (Math.random() * 4 - 2), { steps: 2 });
          await randomDelay(80, 250);
        }

        await page.mouse.up();
        console.log("  [rebrowser] Released. Waiting for response...");
        await page.waitForTimeout(3000);

        try {
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
          console.log("  [rebrowser] Page navigated after CAPTCHA!");
        } catch {
          await page.waitForTimeout(2000);
        }
      }

      console.log("  [rebrowser] CAPTCHA attempt complete");
    } else {
      await page.mouse.move(100 + Math.random() * 400, 100 + Math.random() * 300);
      await randomDelay(200, 600);
      await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 500));
      await randomDelay(500, 1500);
    }

    try {
      await context.storageState({ path: sessionPath });
      console.log(`  [session] Saved session for ${domain}`);
    } catch { /* fine */ }

    const html = await page.content();
    return { html, statusCode: response?.status() ?? 0, finalUrl: page.url(), responseHeaders };
  } finally {
    // Ensure cleanup even if errors occur
    try {
      await page.close().catch(() => {});
    } catch {}
    try {
      await context.close().catch(() => {});
    } catch {}
    try {
      await browser.close().catch(() => {});
    } catch {}
  }
}

// ==========================================================================
// Tier 2a: FlareSolverr (open-source Cloudflare bypass — self-hosted)
// ==========================================================================

async function fetchViaFlareSolverr(url: string, retry = true): Promise<{ html: string; statusCode: number; finalUrl: string }> {
  const baseUrl = process.env.FLARESOLVERR_URL || "";
  if (!baseUrl) throw new Error("FLARESOLVERR_URL not set. Run FlareSolverr (e.g. Docker on port 8191) and set FLARESOLVERR_URL=http://localhost:8191");
  const endpoint = baseUrl.replace(/\/$/, "") + "/v1";

  // Small delay between FlareSolverr calls to avoid overwhelming it
  const domain = getDomain(url);
  const last = lastFlareSolverrTime.get(domain) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < FLARESOLVERR_DELAY_MS) {
    const waitMs = FLARESOLVERR_DELAY_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastFlareSolverrTime.set(domain, Date.now());

  console.log("  [flaresolverr] Fetching via FlareSolverr (Cloudflare bypass)...");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
    });

    const data = (await response.json()) as {
      status: string;
      message?: string;
      solution?: { url?: string; status?: number; response?: string; cookies?: Array<{ name: string; value: string; domain?: string }> };
    };

    if (data.status !== "ok" || !data.solution?.response) {
      const msg = data.message || "FlareSolverr returned no HTML";
      if (retry) {
        console.log(`  [flaresolverr] Failed, retrying once: ${msg}`);
        await randomDelay(1000, 2000);
        return fetchViaFlareSolverr(url, false);
      }
      throw new Error(`FlareSolverr failed: ${msg}`);
    }

    const domain = getDomain(url);
    if (data.solution.cookies?.length) {
      const cookieStr = data.solution.cookies
        .filter((c) => !c.domain || c.domain.includes(domain))
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieStr) {
        const existing = cookieJar.get(domain) || "";
        cookieJar.set(domain, existing ? `${existing}; ${cookieStr}` : cookieStr);
        console.log(`  [cookies] Stored ${data.solution.cookies.length} cookie(s) from FlareSolverr for ${domain}`);
      }
    }

    return {
      html: data.solution.response,
      statusCode: data.solution.status ?? 200,
      finalUrl: data.solution.url || url,
    };
  } catch (err) {
    if (retry && err instanceof Error && !err.message.includes("FLARESOLVERR_URL not set")) {
      console.log(`  [flaresolverr] Network error, retrying once: ${err.message}`);
      await randomDelay(1000, 2000);
      return fetchViaFlareSolverr(url, false);
    }
    throw err;
  }
}

// ==========================================================================
// Tier 2b: Firecrawl fallback for the hardest sites
// ==========================================================================

async function fetchViaFirecrawl(url: string): Promise<{ html: string; statusCode: number; finalUrl: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not set. Add it to .env for Tier 2 fallback.");
  }

  console.log("  [firecrawl] Fetching via Firecrawl API...");

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["html"] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firecrawl API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { success: boolean; data?: { html?: string; metadata?: Record<string, unknown> } };
  if (!data.success || !data.data?.html) {
    throw new Error("Firecrawl scrape failed or returned no HTML");
  }

  return { html: data.data.html, statusCode: 200, finalUrl: url };
}

// ==========================================================================
// Main fetch function -- two-tier fallback chain
// ==========================================================================

export interface FetchResult {
  html: string;
  statusCode: number;
  finalUrl: string;
  method: string;
  httpTimeMs: number;
  playwrightTimeMs: number;
  flaresolverrTimeMs: number;
  firecrawlTimeMs: number;
  totalTimeMs: number;
}

export async function fetchPage(url: string, forceRender = false): Promise<FetchResult> {
  const startTime = Date.now();
  let html: string = "", statusCode: number = 0, finalUrl: string = url, method: string = "unknown";
  let httpTimeMs = 0, playwrightTimeMs = 0, flaresolverrTimeMs = 0, firecrawlTimeMs = 0;

  // Only use proxy for sites that need it -- some sites (like Leasebreak) work
  // better without it because your home IP is already residential
  const PROXY_DOMAINS = new Set([
    "streeteasy.com", "www.streeteasy.com",
    "zillow.com", "www.zillow.com",
    "renthop.com", "www.renthop.com",
    "apartments.com", "www.apartments.com",
  ]);

  // Sites that always get blocked by HTTP/rebrowser → skip straight to FlareSolverr
  const FLARESOLVERR_DOMAINS = new Set([
    "leasebreak.com", "www.leasebreak.com",
    "streeteasy.com", "www.streeteasy.com",
    "renthop.com", "www.renthop.com",
    "zillow.com", "www.zillow.com",
  ]);

  const domain = getDomain(url);
  const hostname = new URL(url).hostname;
  const proxyUrl = PROXY_DOMAINS.has(hostname) ? (process.env.PROXY_URL || undefined) : undefined;
  let skipToFlareSolverr = FLARESOLVERR_DOMAINS.has(hostname) && !!process.env.FLARESOLVERR_URL;
  
  if (proxyUrl) console.log(`  [proxy] Will use proxy for ${domain}`);
  else if (process.env.PROXY_URL) console.log(`  [no-proxy] Skipping proxy for ${domain} (works better without)`);
  if (skipToFlareSolverr) console.log(`  [shortcut] Skipping HTTP/rebrowser for ${domain}, using FlareSolverr directly`);

  if (forceRender) {
    // Skip HTTP, go straight to rebrowser
    const pwStart = Date.now();
    const r = await renderPage(url, proxyUrl);
    playwrightTimeMs = Date.now() - pwStart;
    html = r.html; statusCode = r.statusCode; finalUrl = r.finalUrl;
    method = proxyUrl ? "rebrowser + proxy" : "rebrowser";

    const blockCheck = isBlockedOrThin(html, statusCode);
    if (blockCheck.blocked) {
      dumpDebug(url, html, statusCode, "rebrowser", r.responseHeaders);

      if (process.env.FLARESOLVERR_URL) {
        try {
          console.log(`  rebrowser blocked (${blockCheck.reason}), trying FlareSolverr...`);
          const fsStart = Date.now();
          const fs = await fetchViaFlareSolverr(url);
          flaresolverrTimeMs = Date.now() - fsStart;
          html = fs.html; statusCode = fs.statusCode; finalUrl = fs.finalUrl;
          method = "FlareSolverr";
        } catch (e) {
          console.warn(`  FlareSolverr failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (isBlockedOrThin(html, statusCode).blocked && process.env.FIRECRAWL_API_KEY) {
        console.log(`  Still blocked, trying Firecrawl...`);
        const fcStart = Date.now();
        const fc = await fetchViaFirecrawl(url);
        firecrawlTimeMs = Date.now() - fcStart;
        html = fc.html; statusCode = fc.statusCode; finalUrl = fc.finalUrl;
        method = "Firecrawl";
      }
    }
  } else {
    // Shortcut: For domains that always get blocked, skip straight to FlareSolverr
    if (skipToFlareSolverr) {
      try {
        const fsStart = Date.now();
        const fs = await fetchViaFlareSolverr(url);
        flaresolverrTimeMs = Date.now() - fsStart;
        return {
          html: fs.html,
          statusCode: fs.statusCode,
          finalUrl: fs.finalUrl,
          method: "FlareSolverr",
          httpTimeMs: 0,
          playwrightTimeMs: 0,
          flaresolverrTimeMs,
          firecrawlTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
        };
      } catch (e) {
        console.warn(`  FlareSolverr failed, falling back to normal flow: ${e instanceof Error ? e.message : e}`);
        // Continue to normal HTTP → rebrowser → FlareSolverr flow below
      }
    }

    // Normal flow: HTTP → rebrowser → FlareSolverr (or if skipToFlareSolverr failed, use this as fallback)
    {
      // Tier 0: HTTP first (cheapest, fastest)
      const httpStart = Date.now();
      const r = await httpFetch(url);
      httpTimeMs = Date.now() - httpStart;
      html = r.html; statusCode = r.statusCode; finalUrl = r.finalUrl;
      method = "HTTP";

      let blockCheck = isBlockedOrThin(html, statusCode);

      if (blockCheck.blocked) {
        dumpDebug(url, html, statusCode, "http", r.responseHeaders);

        // Tier 1: rebrowser-playwright (headed + CDP patches + optional proxy + CAPTCHA handling)
        console.log(`  HTTP blocked (${blockCheck.reason}), trying rebrowser...`);
        const pwStart = Date.now();
        const rendered = await renderPage(url, proxyUrl);
        playwrightTimeMs = Date.now() - pwStart;
        html = rendered.html; statusCode = rendered.statusCode; finalUrl = rendered.finalUrl;
        method = proxyUrl ? "rebrowser + proxy" : "rebrowser";

        blockCheck = isBlockedOrThin(html, statusCode);

        if (blockCheck.blocked) {
          dumpDebug(url, html, statusCode, "rebrowser", rendered.responseHeaders);

          // Tier 2a: FlareSolverr (open-source Cloudflare bypass)
          if (process.env.FLARESOLVERR_URL) {
            try {
              console.log(`  rebrowser blocked (${blockCheck.reason}), trying FlareSolverr...`);
              const fsStart = Date.now();
              const fs = await fetchViaFlareSolverr(url);
              flaresolverrTimeMs = Date.now() - fsStart;
              html = fs.html; statusCode = fs.statusCode; finalUrl = fs.finalUrl;
              method = "FlareSolverr";
            } catch (e) {
              console.warn(`  FlareSolverr failed: ${e instanceof Error ? e.message : e}`);
            }
          }
          // Tier 2b: Firecrawl as last resort
          if (isBlockedOrThin(html, statusCode).blocked && process.env.FIRECRAWL_API_KEY) {
            console.log(`  Still blocked, trying Firecrawl...`);
            const fcStart = Date.now();
            const fc = await fetchViaFirecrawl(url);
            firecrawlTimeMs = Date.now() - fcStart;
            html = fc.html; statusCode = fc.statusCode; finalUrl = fc.finalUrl;
            method = "Firecrawl";
          }
        }
      }
    }
  }

  return {
    html, statusCode, finalUrl, method,
    httpTimeMs, playwrightTimeMs, flaresolverrTimeMs, firecrawlTimeMs,
    totalTimeMs: Date.now() - startTime,
  };
}
