"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MeetingDashboardResponse } from "@/lib/types/meetings";

type MeetingsDashboardWidgetsProps = {
  compact?: boolean;
};

function WidgetList({
  title,
  count,
  href,
  items,
}: {
  title: string;
  count: number;
  href: string;
  items: MeetingDashboardResponse["today"];
}) {
  return (
    <Link
      href={href}
      className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">Live operational view</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-lg font-semibold text-slate-900">
          {count}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            Nothing here right now.
          </div>
        ) : (
          items.slice(0, 3).map((meeting) => (
            <div
              key={meeting.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <div className="text-sm font-medium text-slate-900">{meeting.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {new Date(meeting.startTimeMs).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </Link>
  );
}

export function MeetingsDashboardWidgets({ compact = false }: MeetingsDashboardWidgetsProps) {
  const [data, setData] = useState<MeetingDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/meetings/dashboard", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | MeetingDashboardResponse
          | { error?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload && "error" in payload ? payload.error || "Unable to load meetings dashboard." : "Unable to load meetings dashboard.");
        }
        if (!active) return;
        setData(payload as MeetingDashboardResponse);
      } catch (nextError) {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load meetings dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Meetings Pulse
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            Today’s coordination, upcoming sessions, and misses
          </h2>
        </div>
        <Link
          href="/crm/meetings"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open Meetings Hub
        </Link>
      </div>

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className={`grid gap-4 ${compact ? "lg:grid-cols-3" : "xl:grid-cols-3"}`}>
        <WidgetList
          title="Today's Meetings"
          count={loading ? 0 : data?.counts.today ?? 0}
          href="/crm/meetings"
          items={data?.today ?? []}
        />
        <WidgetList
          title="Upcoming Meetings"
          count={loading ? 0 : data?.counts.upcoming ?? 0}
          href="/crm/meetings"
          items={data?.upcoming ?? []}
        />
        <WidgetList
          title="Missed Meetings"
          count={loading ? 0 : data?.counts.missed ?? 0}
          href="/crm/meetings/history"
          items={data?.missed ?? []}
        />
      </div>
    </section>
  );
}
