"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingsDashboardWidgets } from "@/components/meetings/MeetingsDashboardWidgets";
import type { MeetingsListResponse } from "@/lib/types/meetings";

type MeetingsListClientProps = {
  title: string;
  description: string;
  endpoint: "/api/meetings/upcoming" | "/api/meetings/history";
  showDashboard?: boolean;
};

export function MeetingsListClient({
  title,
  description,
  endpoint,
  showDashboard = false,
}: MeetingsListClientProps) {
  const [data, setData] = useState<MeetingsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | MeetingsListResponse
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error || "Unable to load meetings." : "Unable to load meetings.");
      }
      setData(payload as MeetingsListResponse);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load meetings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [endpoint]);

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
                {title}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/crm/meetings/create"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Create Meeting
              </Link>
              <Link
                href="/crm/meetings/recordings"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Recordings
              </Link>
            </div>
          </div>
        </section>

        {showDashboard ? <MeetingsDashboardWidgets /> : null}

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading meetings...
          </div>
        ) : null}

        {!loading && (data?.items.length ?? 0) === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-4 py-12 text-center shadow-sm">
            <div className="text-lg font-semibold text-slate-900">No meetings found</div>
            <p className="mt-2 text-sm text-slate-500">
              Once meetings are scheduled, they’ll show up here with start, join, edit, and cancel actions.
            </p>
          </div>
        ) : null}

        <div className="space-y-4">
          {data?.items.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} onCancelled={load} />
          ))}
        </div>
      </div>
    </div>
  );
}
