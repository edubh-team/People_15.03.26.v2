"use client";

import Link from "next/link";
import { useState } from "react";
import { MeetingStatusBadge } from "@/components/meetings/MeetingStatusBadge";
import type { MeetingViewModel } from "@/lib/types/meetings";

function formatDateTime(meeting: MeetingViewModel) {
  return new Date(meeting.startTimeMs).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type MeetingCardProps = {
  meeting: MeetingViewModel;
  onCancelled?: () => Promise<void> | void;
};

export function MeetingCard({ meeting, onCancelled }: MeetingCardProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setIsCancelling(true);
    setError(null);
    try {
      const response = await fetch("/api/meetings/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meetingId: meeting.id }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to cancel the meeting.");
      }
      await onCancelled?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to cancel the meeting.");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <MeetingStatusBadge status={meeting.status} />
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              {meeting.durationMinutes} min
            </span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{meeting.title}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {formatDateTime(meeting)} · {meeting.timezone}
            </p>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            {meeting.agenda?.trim() || "No agenda added for this meeting yet."}
          </p>
          <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Audience
              </div>
              <div className="mt-1 font-medium text-slate-900">{meeting.audience.scopeSummary}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Participants
              </div>
              <div className="mt-1 font-medium text-slate-900">{meeting.participantCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Attendance
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {meeting.attendanceSummary.attended}/{meeting.attendanceSummary.invited}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {meeting.actionAccess.canStart ? (
              <button
                type="button"
                onClick={() => window.open(meeting.zoho.startUrl, "_blank", "noopener,noreferrer")}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Start Meeting
              </button>
            ) : null}
            {meeting.actionAccess.canJoin ? (
              <button
                type="button"
                onClick={() => window.open(meeting.zoho.joinUrl, "_blank", "noopener,noreferrer")}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Join Meeting
              </button>
            ) : null}
            {meeting.actionAccess.canEdit ? (
              <Link
                href={`/crm/meetings/create?meetingId=${meeting.id}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Edit
              </Link>
            ) : null}
            {meeting.actionAccess.canCancel ? (
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => void handleCancel()}
                className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {isCancelling ? "Cancelling..." : "Cancel"}
              </button>
            ) : null}
          </div>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Participant Snapshot
          </div>
          <div className="mt-3 space-y-2">
            {meeting.participantRows.slice(0, 5).map((participant) => (
              <div
                key={participant.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium text-slate-900">{participant.displayName}</div>
                  <div className="text-xs text-slate-500">{participant.email}</div>
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {participant.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
            {meeting.participantRows.length > 5 ? (
              <div className="text-xs text-slate-500">
                +{meeting.participantRows.length - 5} more participants
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
