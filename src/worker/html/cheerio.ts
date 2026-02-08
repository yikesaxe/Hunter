/**
 * Re-export cheerio.load with a convenience wrapper.
 */
import * as cheerio from "cheerio";

export type CheerioAPI = cheerio.CheerioAPI;

export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}
