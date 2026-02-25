"use client";

import { useEffect, useState } from "react";

type Run = {
  id: string;
  source: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string | null;
  target: number;
  discovered: number;
  scraped: number;
  errors: number;
};

export function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/runs?limit=30")
      .then((r) => r.json())
      .then(setRuns)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-6">Crawl runs</h1>
      {loading ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Source</th>
                <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Started</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Scraped</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Target</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--background)]">
                  <td className="py-3 px-4">{r.source}</td>
                  <td className="py-3 px-4 text-[var(--muted)]">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right">{r.scraped}</td>
                  <td className="py-3 px-4 text-right">{r.target}</td>
                  <td className="py-3 px-4 text-right">{r.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && (
            <p className="p-6 text-[var(--muted)]">No crawl runs yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
