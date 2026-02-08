import type { CheerioAPI } from "./cheerio";

/**
 * Extract trimmed text content from a CSS selector. Returns null if not found or empty.
 */
export function parseText($: CheerioAPI, selector: string): string | null {
  const text = $(selector).first().text().trim();
  return text.length > 0 ? text : null;
}

/**
 * Extract all trimmed text contents from a CSS selector.
 */
export function parseAllText($: CheerioAPI, selector: string): string[] {
  const results: string[] = [];
  $(selector).each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) results.push(text);
  });
  return results;
}

/**
 * Parse a money string like "$3,500" or "$3,500/mo" into cents-free integer (3500).
 * Returns null if unparseable.
 */
export function parseMoney(str: string | null | undefined): number | null {
  if (!str) return null;
  const match = str.match(/\$\s*([\d,]+)/);
  if (!match) return null;
  const cleaned = match[1].replace(/,/g, "");
  const amount = parseInt(cleaned, 10);
  return isNaN(amount) ? null : amount;
}

/**
 * Parse a date from human-readable text like "Feb 07, 2026" or "February 7, 2026".
 * Returns null if unparseable.
 */
export function parseDateFromText(str: string | null | undefined): Date | null {
  if (!str) return null;
  const trimmed = str.trim();

  // Try standard Date.parse first
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) return new Date(parsed);

  // Try extracting a date pattern like "Feb 07, 2026"
  const match = trimmed.match(
    /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/
  );
  if (match) {
    const dateStr = `${match[1]} ${match[2]}, ${match[3]}`;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Parse a number from text like "2" or "1.5". Returns null if unparseable.
 */
export function parseNumber(str: string | null | undefined): number | null {
  if (!str) return null;
  const trimmed = str.trim();
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : num;
}

/**
 * Extract attribute value from first matching element.
 */
export function parseAttr(
  $: CheerioAPI,
  selector: string,
  attr: string
): string | null {
  const val = $(selector).first().attr(attr);
  return val && val.trim().length > 0 ? val.trim() : null;
}

/**
 * Collect all attribute values from matching elements.
 */
export function parseAllAttr(
  $: CheerioAPI,
  selector: string,
  attr: string
): string[] {
  const results: string[] = [];
  $(selector).each((_, el) => {
    const val = $(el).attr(attr);
    if (val && val.trim().length > 0) results.push(val.trim());
  });
  return results;
}
