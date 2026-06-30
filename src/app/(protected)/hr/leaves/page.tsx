"use client";

import { useMemo, useState } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  isAdminUser,
  isHrUser,
  isManagerUser,
  isTeamLeadUser,
  normalizeRoleValue,
} from "@/lib/access";
import type { LeaveAuthorityTab } from "@/lib/people/ops";
import { useHrLeaveAuthority } from "@/lib/people/ops";

const STATUS_LABELS: Record<LeaveAuthorityTab, string> = {
  pending: "Pending Queue",
  approved: "Approved",
  rejected: "Rejected",
};

function formatDateKey(key: string) {
  if (!key) return "-";
  const date = new Date(key);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString();
}

export default function LeaveRequestsPage() {
  const { userDoc } = useAuth();
  const [activeTab, setActiveTab] = useState<LeaveAuthorityTab>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const { rows, counts, loading, error, updateStatus } = useHrLeaveAuthority(userDoc, activeTab);
  const role = normalizeRoleValue(userDoc?.orgRole ?? userDoc?.role);
  const isHrActor = role === "HR";
  const isManagerActor = isManagerUser(userDoc) || isTeamLeadUser(userDoc);

  const pendingTabLabel = useMemo(() => {
    if (isHrActor) return "Pending HR Review";
    if (isManagerActor) return "Pending Manager Approval";
    return "Pending Queue";
  }, [isHrActor, isManagerActor]);

  const tabLabels = useMemo(
    () => ({
      pending: pendingTabLabel,
      approved: STATUS_LABELS.approved,
      rejected: STATUS_LABELS.rejected,
    }),
    [pendingTabLabel],
  );

  const getApproveLabel = (status: string, hasReportingManager: boolean) => {
    const normalized = status.toLowerCase();
    if (normalized === "pending_manager") return "Final Approve";
    if (!hasReportingManager) return "Approve";
    return "Approve & Forward";
  };

  const leaveTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => (row.type || "").trim()).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return rows.filter((leave) => {
      if (typeFilter !== "ALL" && leave.type !== typeFilter) return false;
      if (!term) return true;
      return [
        leave.userName ?? "",
        leave.userEmail ?? "",
        leave.reason ?? "",
        leave.assignedHrName ?? "",
        leave.reportingManagerName ?? "",
        leave.uid ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [rows, searchQuery, typeFilter]);

  return (
    <AuthGate allowIf={(user) => isHrUser(user) || isManagerUser(user) || isTeamLeadUser(user) || isAdminUser(user)}>
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Leave Requests</h1>
        <p className="mb-6 text-sm text-slate-500">
          Workflow: BDA leave requests route to HR first, then reporting manager final approval.
        </p>

        <div className="mb-6 flex gap-1 border-b border-slate-200">
          {(["pending", "approved", "rejected"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tabLabels[tab]}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeTab === tab ? "bg-indigo-50" : "bg-slate-100"}`}>
                {counts[tab]}
              </span>
            </button>
          ))}
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search employee, reason, HR, manager..."
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="ALL">All leave types</option>
            {leaveTypeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">Loading leave requests...</div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700">{error.message}</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No {tabLabels[activeTab].toLowerCase()} requests.</div>
        ) : (
          <div className="space-y-4">
            {filteredRows.map((leave) => {
              const normalizedStatus = (leave.status ?? "").toLowerCase();
              const stageLabel =
                normalizedStatus === "pending_manager"
                  ? "Manager Stage"
                  : normalizedStatus === "pending_hr" || normalizedStatus === "pending"
                    ? "HR Stage"
                    : normalizedStatus === "approved"
                      ? "Approved"
                      : "Rejected";
              return (
                <div
                  key={leave.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row"
                >
                  <div>
                    <div className="mb-2 flex items-center gap-3">
                      <span className="font-semibold text-slate-900">{leave.userName}</span>
                      <span className="text-sm text-slate-500">({leave.userEmail})</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-700">{leave.type}</span>
                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{stageLabel}</span>
                    </div>
                    <div className="mb-2 text-slate-600">
                      {formatDateKey(leave.startDateKey)} {" - "} {formatDateKey(leave.endDateKey)}
                    </div>
                    <div className="mb-2 text-xs text-slate-500">
                      HR: {leave.assignedHrName ?? (leave.assignedHR ? leave.assignedHR : "Auto queue")} | Reporting Manager: {leave.reportingManagerName ?? (leave.reportingManagerId ? leave.reportingManagerId : "Not set")}
                    </div>
                    <div className="mb-2 text-xs text-slate-500">
                      Chargeable days: {leave.chargeableDays ?? "-"} | Sat excluded: {leave.saturdayExcludedDays ?? 0} | Sun excluded: {leave.sundayExcludedDays ?? 0}
                    </div>
                    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{leave.reason}</p>
                    {leave.attachmentUrl ? (
                      <a
                        href={leave.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm text-indigo-600 hover:underline"
                      >
                        View Attachment
                      </a>
                    ) : null}
                  </div>

                  {activeTab === "pending" ? (
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => updateStatus(leave.id, "approved")}
                        className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        <CheckCircleIcon className="h-5 w-5" />
                        {getApproveLabel(normalizedStatus, Boolean(leave.reportingManagerId))}
                      </button>
                      <button
                        onClick={() => updateStatus(leave.id, "rejected")}
                        className="flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-2 font-medium text-rose-700 transition-colors hover:bg-rose-100"
                      >
                        <XCircleIcon className="h-5 w-5" />
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AuthGate>
  );
}
