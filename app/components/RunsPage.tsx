"use client";

import { useEffect, useRef, useState } from "react";

type CrawlJob = {
  id: string;
  source: string;
  searchUrl: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string;
  totalDiscovered: number;
  totalScraped: number;
  consecutiveFails: number;
};

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
  mode: string;
  isComplete: boolean;
};

const SOURCE_COLORS: Record<string, string> = {
  streeteasy: "bg-blue-100 text-blue-700",
  renthop:    "bg-purple-100 text-purple-700",
  leasebreak: "bg-emerald-100 text-emerald-700",
  zillow:     "bg-yellow-100 text-yellow-700",
};

function sourceChip(source: string) {
  const cls = SOURCE_COLORS[source] ?? "bg-[var(--surface)] text-[var(--muted)]";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${cls}`}>
      {source}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    idle:    "bg-[var(--surface)] text-[var(--muted)]",
    running: "bg-yellow-100 text-yellow-700 animate-pulse",
    failed:  "bg-red-100 text-red-600",
    queued:  "bg-blue-100 text-blue-600",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${map[status] ?? "bg-[var(--surface)] text-[var(--muted)]"}`}>
      {status}
    </span>
  );
}

function relativeTime(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function nextRunIn(ts: string): string {
  const diff = new Date(ts).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `in ${h}h ${m % 60}m`;
  return `in ${m}m`;
}

export function RunsPage() {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerMsg, setTriggerMsg] = useState<Record<string, string>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchData() {
    const [jobsRes, runsRes] = await Promise.allSettled([
      fetch("/api/crawl-jobs", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/runs?limit=30").then((r) => r.json()),
    ]);
    if (jobsRes.status === "fulfilled" && Array.isArray(jobsRes.value)) setJobs(jobsRes.value);
    if (runsRes.status === "fulfilled" && Array.isArray(runsRes.value)) setRuns(runsRes.value);
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30s
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  async function runNow(job: CrawlJob) {
    setTriggering(job.id);
    try {
      const res = await fetch("/api/crawl-jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crawlJobId: job.id }),
      });
      if (res.ok) {
        setTriggerMsg((m) => ({ ...m, [job.id]: "Queued! Refresh in a moment." }));
        setTimeout(() => {
          fetchData();
          setTriggerMsg((m) => { const n = { ...m }; delete n[job.id]; return n; });
        }, 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setTriggerMsg((m) => ({ ...m, [job.id]: (err as { error?: string }).error ?? "Failed" }));
        setTimeout(() => setTriggerMsg((m) => { const n = { ...m }; delete n[job.id]; return n; }), 4000);
      }
    } catch {
      setTriggerMsg((m) => ({ ...m, [job.id]: "Network error" }));
      setTimeout(() => setTriggerMsg((m) => { const n = { ...m }; delete n[job.id]; return n; }), 4000);
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 py-10 space-y-10">
      {/* Scheduled Jobs */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-semibold text-[var(--foreground)]">Scheduled Jobs</h2>
          <button
            type="button"
            onClick={fetchData}
            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-[var(--muted)] text-sm">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-[var(--muted)] text-sm">
            No scheduled jobs. Complete onboarding to create crawl jobs for your preferences.
          </p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Source</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Last run</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Next run</th>
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Scraped</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--background)]">
                    <td className="py-3 px-4">{sourceChip(job.source)}</td>
                    <td className="py-3 px-4"><StatusBadge status={job.status} /></td>
                    <td className="py-3 px-4 text-[var(--muted)]">{relativeTime(job.lastRunAt)}</td>
                    <td className="py-3 px-4 text-[var(--muted)]">{nextRunIn(job.nextRunAt)}</td>
                    <td className="py-3 px-4 text-right text-[var(--muted)]">{job.totalScraped.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right">
                      {triggerMsg[job.id] ? (
                        <span className="text-xs text-[var(--accent)]">{triggerMsg[job.id]}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={triggering === job.id || job.status === "running"}
                          onClick={() => runNow(job)}
                          className="text-xs font-medium px-3 py-1 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                        >
                          {triggering === job.id ? "…" : "Run now"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Runs */}
      <section>
        <h2 className="font-serif text-2xl font-semibold text-[var(--foreground)] mb-4">Recent Runs</h2>
        {loading ? (
          <p className="text-[var(--muted)] text-sm">Loading…</p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Source</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Mode</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Started</th>
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Found</th>
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Scraped</th>
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--background)]">
                    <td className="py-3 px-4">{sourceChip(r.source)}</td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        r.mode === "registry"
                          ? "bg-[var(--surface)] text-[var(--muted)]"
                          : "bg-[var(--accent-light,#F0EBE3)] text-[var(--accent)]"
                      }`}>
                        {r.mode}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--muted)]">{relativeTime(r.startedAt)}</td>
                    <td className="py-3 px-4 text-right text-[var(--muted)]">{r.discovered}</td>
                    <td className={`py-3 px-4 text-right font-medium ${r.scraped === 0 && r.discovered > 0 ? "text-amber-600" : ""}`}>
                      {r.scraped === 0 && r.discovered > 0
                        ? <span title="All discovered URLs were fresh (scraped recently)">{r.scraped} ↺</span>
                        : r.scraped}
                    </td>
                    <td className={`py-3 px-4 text-right ${r.errors > 0 ? "text-red-500" : "text-[var(--muted)]"}`}>
                      {r.errors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {runs.length === 0 && (
              <p className="p-6 text-[var(--muted)]">No crawl runs yet.</p>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--muted-light)]">
          Auto-refreshes every 30s. &ldquo;Found ↺&rdquo; means all discovered URLs were already scraped recently (freshness gate).
        </p>
      </section>
    </div>
  );
}
