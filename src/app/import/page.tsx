"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

interface ImportResult {
  success: boolean;
  normalizedListingId?: string;
  parsed?: {
    title: string;
    address: string;
    unit: string | null;
    neighborhood: string | null;
    borough: string | null;
    rentGross: number | null;
    rentNetEffective: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    brokerFee: boolean | null;
    lat: number | null;
    lng: number | null;
  };
  error?: string;
}

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<"firecrawl" | "paste">("firecrawl");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const body: { url: string; html?: string } = { url };
      if (mode === "paste" && html) {
        body.html = html;
      }
      // In firecrawl mode, we just send the URL — the server fetches via Firecrawl

      const res = await fetch("/api/import/streeteasy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
          &larr; Back to search
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Import StreetEasy Listing</h1>
        <p className="text-gray-500 text-sm mb-6">
          Import a listing by pasting a StreetEasy URL. We&apos;ll fetch and parse it automatically.
        </p>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode("firecrawl")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              mode === "firecrawl"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Auto-fetch (URL only)
          </button>
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              mode === "paste"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Paste HTML manually
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              StreetEasy Listing URL
            </label>
            <input
              type="url"
              required
              placeholder="https://streeteasy.com/building/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {mode === "paste" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Page Source HTML
              </label>
              <textarea
                required
                rows={10}
                placeholder="Paste the full page source HTML here..."
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                {html.length > 0
                  ? `${(html.length / 1024).toFixed(0)} KB pasted`
                  : "No content yet"}
              </p>
            </div>
          )}

          {mode === "firecrawl" && (
            <p className="text-xs text-gray-400">
              The page will be fetched server-side via Firecrawl. Just paste the URL and click import.
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !url || (mode === "paste" && !html)}
            className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Importing..." : "Import Listing"}
          </button>
        </form>

        {result && (
          <div
            className={`mt-6 p-4 rounded-lg ${
              result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
            }`}
          >
            {result.success ? (
              <div>
                <p className="font-medium text-green-800 mb-2">Listing imported successfully!</p>
                <div className="text-sm text-green-700 space-y-1">
                  <p><strong>Address:</strong> {result.parsed?.address}{result.parsed?.unit ? ` #${result.parsed.unit}` : ""}</p>
                  {result.parsed?.neighborhood && (
                    <p><strong>Location:</strong> {result.parsed.neighborhood}{result.parsed.borough ? `, ${result.parsed.borough}` : ""}</p>
                  )}
                  {result.parsed?.rentGross && (
                    <p><strong>Rent:</strong> ${result.parsed.rentGross.toLocaleString()}/mo
                      {result.parsed.rentNetEffective ? ` (net effective: $${result.parsed.rentNetEffective.toLocaleString()})` : ""}
                    </p>
                  )}
                  {result.parsed?.bedrooms != null && (
                    <p><strong>Layout:</strong> {result.parsed.bedrooms === 0 ? "Studio" : `${result.parsed.bedrooms} bed`}
                      {result.parsed?.bathrooms != null ? ` / ${result.parsed.bathrooms} bath` : ""}
                    </p>
                  )}
                  {result.parsed?.brokerFee === false && <p><strong>Fee:</strong> No broker fee</p>}
                  {result.parsed?.brokerFee === true && <p><strong>Fee:</strong> Broker fee applies</p>}
                </div>
                <Link
                  href="/"
                  className="inline-block mt-3 text-blue-600 hover:underline text-sm"
                >
                  View in search results &rarr;
                </Link>
              </div>
            ) : (
              <p className="text-red-800">Error: {result.error}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
