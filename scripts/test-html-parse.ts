/**
 * Test HTML parsing helpers against a saved Leasebreak fixture.
 * Run: npx tsx scripts/test-html-parse.ts
 */
import * as fs from "fs";
import { loadHtml } from "../src/worker/html/cheerio";
import { parseText, parseMoney, parseDateFromText, parseNumber } from "../src/worker/html/parse";

const html = fs.readFileSync("fixtures/leasebreak/detail-353111.html", "utf-8");
const $ = loadHtml(html);

console.log("=== parseText tests ===");
console.log("Title (h2):", parseText($, "h2"));
console.log("Title tag:", parseText($, "title"));
console.log("Neighborhood:", parseText($, ".title-detail-apartments-text"));

console.log("\n=== parseMoney tests ===");
console.log('parseMoney("$3,500/mo"):', parseMoney("$3,500/mo"));
console.log('parseMoney("$7,294"):', parseMoney("$7,294"));
console.log('parseMoney("free"):', parseMoney("free"));
console.log('parseMoney(null):', parseMoney(null));

console.log("\n=== parseDateFromText tests ===");
console.log('parseDateFromText("Feb 07, 2026"):', parseDateFromText("Feb 07, 2026"));
console.log('parseDateFromText("January 15, 2026"):', parseDateFromText("January 15, 2026"));
console.log('parseDateFromText(null):', parseDateFromText(null));

console.log("\n=== parseNumber tests ===");
console.log('parseNumber("2"):', parseNumber("2"));
console.log('parseNumber("1.5"):', parseNumber("1.5"));
console.log('parseNumber(""):', parseNumber(""));

console.log("\nAll HTML parse tests passed.");
