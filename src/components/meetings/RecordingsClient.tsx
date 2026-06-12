"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MeetingRecordingsResponse } from "@/lib/types/meetings";

export function RecordingsClient() {
  const [data, setData] = useState<MeetingRecordingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/meetings/recordings", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | MeetingRecordingsResponse
          | { error?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload && "error" in payload ? payload.error || "Unable to load recordings." : "Unable to load recordings.");
        }
        if (!active) return;
        setData(payload as MeetingRecordingsResponse);
      } catch (nextError) {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load recordings.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F7] px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                CRM Meetings
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                Recordings
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Synced Zoho Meeting recordings linked back to your accessible CRM meetings, including play, download, transcript, and summary assets where available.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/crm/meetings"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Upcoming Meetings
              </Link>
              <Link
                href="/crm/meetings/history"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Meeting History
              </Link>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading recordings...
          </div>
        ) : null}

        {!loading && (data?.items.length ?? 0) === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-4 py-12 text-center shadow-sm">
            <div className="text-lg font-semibold text-slate-900">No recordings yet</div>
            <p className="mt-2 text-sm text-slate-500">
              Recordings will appear here once Zoho finishes processing them for completed meetings.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {data?.items.map((recording) => (
            <article
              key={recording.id}
              className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {recording.topic || "Meeting recording"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {recording.startTimeMs
                      ? new Date(recording.startTimeMs).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Start time unavailable"}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {recording.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Duration
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{recording.durationMinutes} min</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    File Size
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{recording.fileSizeLabel || "Unknown"}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Meeting Key
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{recording.meetingKey}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {recording.playUrl ? (
                  <a
                    href={recording.playUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Play
                  </a>
                ) : null}
                {recording.downloadUrl ? (
                  <a
                    href={recording.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Download
                  </a>
                ) : null}
                {recording.transcriptDownloadUrl ? (
                  <a
                    href={recording.transcriptDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Transcript
                  </a>
                ) : null}
                {recording.summaryDownloadUrl ? (
                  <a
                    href={recording.summaryDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    Summary
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
