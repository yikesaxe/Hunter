"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

interface SearchResult {
  id: string;
  address: string | null;
  unit: string | null;
  neighborhood: string | null;
  borough: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rentGross: number | null;
  rentNetEffective: number | null;
  brokerFee: boolean | null;
  activeState: string;
  lastSeenAt: string;
  sourcesCount: number;
}

interface SearchResponse {
  results: SearchResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

export default function Home() {
  const [maxRent, setMaxRent] = useState("");
  const [minBeds, setMinBeds] = useState("");
  const [borough, setBorough] = useState("");
  const [noFeePreferred, setNoFeePreferred] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pagination, setPagination] = useState<SearchResponse["pagination"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: FormEvent, page = 1) {
    e.preventDefault();
    setLoading(true);
    setSearched(true);

    const params = new URLSearchParams();
    if (maxRent) params.set("maxRent", maxRent);
    if (minBeds) params.set("minBeds", minBeds);
    if (borough) params.set("borough", borough);
    if (noFeePreferred) params.set("noFeePreferred", "true");
    params.set("page", String(page));

    try {
      const res = await fetch(`/api/search?${params}`);
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setPagination(data.pagination);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Hunter</h1>
        <p className="text-gray-500 mb-6">NYC Apartment Listings Aggregator</p>

        {/* Search Form */}
        <form
          onSubmit={handleSearch}
          className="bg-white rounded-lg shadow p-6 mb-8"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Rent
              </label>
              <input
                type="number"
                placeholder="e.g. 3000"
                value={maxRent}
                onChange={(e) => setMaxRent(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Bedrooms
              </label>
              <input
                type="number"
                step="0.5"
                placeholder="e.g. 1"
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Borough
              </label>
              <select
                value={borough}
                onChange={(e) => setBorough(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Boroughs</option>
                {BOROUGHS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={noFeePreferred}
                  onChange={(e) => setNoFeePreferred(e.target.checked)}
                  className="rounded border-gray-300"
                />
                No-fee preferred
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {/* Results */}
        {searched && (
          <div>
            {pagination && (
              <p className="text-sm text-gray-500 mb-4">
                {pagination.total} result{pagination.total !== 1 ? "s" : ""} found
              </p>
            )}

            {results.length === 0 && !loading && (
              <p className="text-gray-400 text-center py-12">
                No listings found. Try adjusting your filters.
              </p>
            )}

            <div className="space-y-4">
              {results.map((unit) => (
                <Link
                  key={unit.id}
                  href={`/units/${unit.id}`}
                  className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow p-5"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {unit.address || "Address unknown"}
                        {unit.unit ? `, #${unit.unit}` : ""}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {[unit.neighborhood, unit.borough]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <div className="flex gap-4 mt-2 text-sm text-gray-600">
                        {unit.bedrooms != null && (
                          <span>
                            {unit.bedrooms === 0
                              ? "Studio"
                              : `${unit.bedrooms} bed`}
                          </span>
                        )}
                        {unit.bathrooms != null && (
                          <span>{unit.bathrooms} bath</span>
                        )}
                        {unit.brokerFee === false && (
                          <span className="text-green-600 font-medium">
                            No Fee
                          </span>
                        )}
                        {unit.brokerFee === true && (
                          <span className="text-orange-500">Broker Fee</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {unit.rentGross != null && (
                        <p className="text-xl font-bold text-gray-900">
                          ${unit.rentGross.toLocaleString()}
                        </p>
                      )}
                      <span
                        className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          unit.activeState === "active"
                            ? "bg-green-100 text-green-700"
                            : unit.activeState === "stale"
                            ? "bg-red-100 text-red-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {unit.activeState}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">
                        {unit.sourcesCount} source{unit.sourcesCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <button
                      key={p}
                      onClick={(e) => handleSearch(e, p)}
                      className={`px-3 py-1 rounded text-sm ${
                        p === pagination.page
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 border hover:bg-gray-50"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
