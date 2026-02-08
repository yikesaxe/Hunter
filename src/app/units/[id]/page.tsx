"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface Posting {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  rentGross: number | null;
  rentNetEffective: number | null;
  brokerFee: boolean | null;
  address: string | null;
  unit: string | null;
  description: string | null;
  images: string[];
  lastSeenAt: string;
  firstSeenAt: string;
  matchScore: number;
}

interface ChangeLogEntry {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface UnitDetail {
  id: string;
  address: string | null;
  unit: string | null;
  neighborhood: string | null;
  borough: string | null;
  lat: number | null;
  lng: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rentGross: number | null;
  rentNetEffective: number | null;
  brokerFee: boolean | null;
  activeState: string;
  lastSeenAt: string;
  createdAt: string;
}

interface UnitResponse {
  unit: UnitDetail;
  postings: Posting[];
  changeLog: ChangeLogEntry[];
}

export default function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<UnitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/units/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Unit not found");
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error || "Something went wrong"}</p>
        <Link href="/" className="text-blue-600 hover:underline text-sm">
          Back to search
        </Link>
      </main>
    );
  }

  const { unit, postings, changeLog } = data;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link
          href="/"
          className="text-blue-600 hover:underline text-sm mb-4 inline-block"
        >
          &larr; Back to search
        </Link>

        {/* Image Gallery */}
        {(() => {
          const allImages = postings.flatMap((p) => p.images || []);
          const uniqueImages = [...new Set(allImages)].slice(0, 10);
          if (uniqueImages.length === 0) return null;
          return (
            <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
              {uniqueImages.length === 1 ? (
                <img
                  src={uniqueImages[0]}
                  alt={unit.address || "Listing"}
                  className="w-full h-72 object-cover"
                />
              ) : (
                <div className="grid grid-cols-3 gap-0.5 max-h-72 overflow-hidden">
                  <img
                    src={uniqueImages[0]}
                    alt={unit.address || "Listing"}
                    className="col-span-2 row-span-2 w-full h-72 object-cover"
                  />
                  {uniqueImages.slice(1, 3).map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt={`Photo ${i + 2}`}
                      className="w-full h-36 object-cover"
                    />
                  ))}
                </div>
              )}
              {uniqueImages.length > 3 && (
                <p className="text-xs text-gray-400 px-4 py-2">
                  +{uniqueImages.length - 3} more photos
                </p>
              )}
            </div>
          );
        })()}

        {/* Unit Header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {unit.address || "Address unknown"}
                {unit.unit ? `, #${unit.unit}` : ""}
              </h1>
              <p className="text-gray-500 mt-1">
                {[unit.neighborhood, unit.borough].filter(Boolean).join(", ")}
              </p>
              <div className="flex gap-4 mt-3 text-sm text-gray-600">
                {unit.bedrooms != null && (
                  <span>
                    {unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bed`}
                  </span>
                )}
                {unit.bathrooms != null && (
                  <span>{unit.bathrooms} bath</span>
                )}
                {unit.brokerFee === false && (
                  <span className="text-green-600 font-medium">No Fee</span>
                )}
                {unit.brokerFee === true && (
                  <span className="text-orange-500">Broker Fee</span>
                )}
              </div>
            </div>
            <div className="text-right">
              {unit.rentGross != null && (
                <p className="text-2xl font-bold text-gray-900">
                  ${unit.rentGross.toLocaleString()}/mo
                </p>
              )}
              {unit.rentNetEffective != null &&
                unit.rentNetEffective !== unit.rentGross && (
                  <p className="text-sm text-gray-500">
                    Net effective: ${unit.rentNetEffective.toLocaleString()}
                  </p>
                )}
              <span
                className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                  unit.activeState === "active"
                    ? "bg-green-100 text-green-700"
                    : unit.activeState === "stale"
                    ? "bg-red-100 text-red-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {unit.activeState}
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Last seen: {new Date(unit.lastSeenAt).toLocaleDateString()} &middot;
            First tracked: {new Date(unit.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Postings from Sources */}
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Source Listings ({postings.length})
        </h2>
        <div className="space-y-3 mb-8">
          {postings.map((posting) => (
            <div
              key={posting.id}
              className="bg-white rounded-lg shadow p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-gray-900">{posting.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Source:{" "}
                    <span className="font-mono bg-gray-100 px-1 rounded">
                      {posting.source}
                    </span>
                    {" "}&middot; Match score: {posting.matchScore}
                  </p>
                  {posting.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {posting.description}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm whitespace-nowrap ml-4">
                  {posting.rentGross != null && (
                    <p className="font-semibold">
                      ${posting.rentGross.toLocaleString()}
                    </p>
                  )}
                  {posting.brokerFee === false && (
                    <span className="text-green-600 text-xs">No Fee</span>
                  )}
                  {posting.brokerFee === true && (
                    <span className="text-orange-500 text-xs">Fee</span>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                First seen: {new Date(posting.firstSeenAt).toLocaleDateString()}{" "}
                &middot; Last seen:{" "}
                {new Date(posting.lastSeenAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>

        {/* Change Log */}
        {changeLog.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Change History
            </h2>
            <div className="bg-white rounded-lg shadow divide-y">
              {changeLog.map((entry) => (
                <div key={entry.id} className="px-4 py-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${
                          entry.kind === "price_change"
                            ? "bg-purple-100 text-purple-700"
                            : entry.kind === "status_change"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {entry.kind.replace("_", " ")}
                      </span>
                      <span className="text-sm text-gray-600">
                        {formatPayload(entry.payload)}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function formatPayload(payload: Record<string, unknown>): string {
  if ("oldRentGross" in payload && "newRentGross" in payload) {
    return `$${Number(payload.oldRentGross).toLocaleString()} → $${Number(payload.newRentGross).toLocaleString()}`;
  }
  if ("field" in payload) {
    return `${payload.field}: ${String(payload.oldValue)} → ${String(payload.newValue)}`;
  }
  return JSON.stringify(payload);
}
