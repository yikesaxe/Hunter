"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

interface ImportResult {
  success: boolean;
  normalizedListingId?: string;
  parsed?: {
    title: string;
    address: string;
    neighborhood: string | null;
    borough: string | null;
    rentGross: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    brokerFee: boolean | null;
  };
  error?: string;
}

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/import/streeteasy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html }),
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
          StreetEasy doesn&apos;t allow automated crawling. To import a listing, open the
          StreetEasy page in your browser, right-click &rarr; <strong>View Page Source</strong>,
          select all (Cmd+A), copy (Cmd+C), and paste below.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              StreetEasy Listing URL
            </label>
            <input
              type="url"
              required
              placeholder="https://streeteasy.com/rental/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Source HTML
            </label>
            <textarea
              required
              rows={12}
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

          <button
            type="submit"
            disabled={loading || !html || !url}
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
                  <p>Title: {result.parsed?.title}</p>
                  <p>Address: {result.parsed?.address}</p>
                  {result.parsed?.neighborhood && (
                    <p>Neighborhood: {result.parsed.neighborhood}, {result.parsed.borough}</p>
                  )}
                  {result.parsed?.rentGross && (
                    <p>Rent: ${result.parsed.rentGross.toLocaleString()}/mo</p>
                  )}
                  {result.parsed?.bedrooms != null && (
                    <p>
                      {result.parsed.bedrooms === 0 ? "Studio" : `${result.parsed.bedrooms} bed`}
                      {result.parsed?.bathrooms != null && ` / ${result.parsed.bathrooms} bath`}
                    </p>
                  )}
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
