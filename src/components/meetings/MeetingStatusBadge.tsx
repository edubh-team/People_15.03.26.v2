"use client";

import type { MeetingLifecycleStatus } from "@/lib/types/meetings";

function getStatusClasses(status: MeetingLifecycleStatus) {
  switch (status) {
    case "live":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "sync_error":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }
}

function getStatusLabel(status: MeetingLifecycleStatus) {
  switch (status) {
    case "live":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "sync_error":
      return "Sync Error";
    default:
      return "Scheduled";
  }
}

export function MeetingStatusBadge({ status }: { status: MeetingLifecycleStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusClasses(status)}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}
