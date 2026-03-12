"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@headlessui/react";
import { useAuth } from "@/components/auth/AuthProvider";
import { RoleBadge } from "@/components/RoleBadge";
import { isAdminUser, isHrUser, isManagerUser } from "@/lib/access";
import type { UserDoc } from "@/lib/types/user";
import {
  reviewHrAttendanceOverride,
  updateHrAttendanceRecord,
  useHrAttendanceOversight,
  type AttendanceOverrideAuditRow,
  type HrAttendanceRecord,
} from "@/lib/people/ops";

function getTodayKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatAttendanceTime(value: unknown) {
  if (!value || typeof value !== "object") return "-";
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") {
    const date = maybe.toDate();
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (typeof maybe.seconds === "number") {
    const date = new Date(maybe.seconds * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return "-";
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybe.toDate === "function") {
      const date = maybe.toDate();
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000;
    }
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getAuditActionLabel(row: AttendanceOverrideAuditRow) {
  switch (row.actionType) {
    case "manager_mark_absent":
      return "Manager mark absent";
    case "attendance_override":
      return "HR override";
    case "hr_review_approved":
      return "HR approved";
    case "hr_review_rejected":
      return "HR rejected";
    default:
      return "Correction";
  }
}

function getCorrectionTone(status: HrAttendanceRecord["correctionStatus"]) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-rose-100 text-rose-800";
  if (status === "pending_hr_review") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function AttendanceOversightPage() {
  const { userDoc } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => getTodayKey());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "present" | "late" | "absent" | "on_leave">("all");
  const { users, attendanceByUid, overrideAuditRows, stats, loading, error } = useHrAttendanceOversight(selectedDate);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDoc | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<HrAttendanceRecord | null>(null);
  const [editStatus, setEditStatus] = useState("present");
  const [editTime, setEditTime] = useState("");
  const [editReason, setEditReason] = useState("");
  const [updating, setUpdating] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const canReviewCorrections = isAdminUser(userDoc) || isHrUser(userDoc);
  const canMarkAbsentOverride = isAdminUser(userDoc) || isManagerUser(userDoc);
  const canEditAttendance = canReviewCorrections || canMarkAbsentOverride;

  const pendingOverrideByUser = useMemo(() => {
    const map = new Map<string, AttendanceOverrideAuditRow>();
    overrideAuditRows
      .filter((row) => row.correctionStatus === "pending_hr_review" && row.actionType === "manager_mark_absent")
      .forEach((row) => {
        if (!row.uid) return;
        const previous = map.get(row.uid);
        if (!previous || toMillis(row.createdAt) > toMillis(previous.createdAt)) {
          map.set(row.uid, row);
        }
      });
    return map;
  }, [overrideAuditRows]);

  const openEdit = (user: UserDoc) => {
    const record = attendanceByUid[user.uid];
    setSelectedUser(user);
    setSelectedRecord(record ?? null);
    if (record) {
      const normalizedStatus = (record.status ?? "").toLowerCase();
      setEditStatus(
        normalizedStatus === "absent" || normalizedStatus === "on_leave" || normalizedStatus === "checked_out"
          ? normalizedStatus
          : (record.dayStatus ?? normalizedStatus ?? "present").toLowerCase(),
      );
      const timeValue = record.checkedInAt ?? record.checkInTime;
      const formatted = formatAttendanceTime(timeValue);
      setEditTime(formatted === "-" ? "" : formatted);
    } else {
      setEditStatus(canReviewCorrections ? "present" : "absent");
      setEditTime("");
    }
    setEditReason("");
    setIsEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!selectedUser || !userDoc) return;
    if (!editReason.trim()) {
      alert("Override reason is mandatory.");
      return;
    }
    setUpdating(true);
    try {
      await updateHrAttendanceRecord({
        uid: selectedUser.uid,
        dateKey: selectedDate,
        status: editStatus,
        checkInTime: editTime,
        reason: editReason,
        actor: {
          uid: userDoc.uid,
          displayName: userDoc.displayName ?? null,
          email: userDoc.email ?? null,
          role: userDoc.role ?? null,
          orgRole: userDoc.orgRole ?? null,
        },
        record: selectedRecord,
      });
      setIsEditOpen(false);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Unable to update attendance";
      alert(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleReview = async (
    row: AttendanceOverrideAuditRow,
    decision: "approved" | "rejected",
  ) => {
    if (!userDoc) return;
    const reason = window.prompt(
      decision === "approved"
        ? "Enter approval reason for this correction:"
        : "Enter rejection reason for this correction:",
    );
    if (!reason || !reason.trim()) return;

    setReviewingId(row.id);
    try {
      await reviewHrAttendanceOverride({
        overrideAuditId: row.id,
        decision,
        reason,
        actor: {
          uid: userDoc.uid,
          displayName: userDoc.displayName ?? null,
          email: userDoc.email ?? null,
          role: userDoc.role ?? null,
          orgRole: userDoc.orgRole ?? null,
        },
      });
    } catch (reviewError) {
      const message =
        reviewError instanceof Error ? reviewError.message : "Unable to review correction.";
      alert(message);
    } finally {
      setReviewingId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const record = attendanceByUid[user.uid];
      const present = (record?.status ?? "").toLowerCase();
      const isPresent =
        present === "present" ||
        present === "checked_in" ||
        present === "checked_out" ||
        present === "on_break";
      const isLate = record?.late || (record?.dayStatus ?? "").toLowerCase() === "late";
      const normalizedStatus =
        present === "on_leave" ? "on_leave" : isPresent ? (isLate ? "late" : "present") : "absent";

      if (statusFilter !== "all" && normalizedStatus !== statusFilter) return false;
      if (!term) return true;

      return [user.displayName ?? "", user.email ?? "", user.orgRole ?? user.role ?? "", user.employeeId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [attendanceByUid, searchQuery, statusFilter, users]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Attendance Oversight</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search employee, role, ID..."
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All status</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="on_leave">On leave</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="font-medium text-emerald-600">Present</div>
          <div className="text-2xl font-bold text-emerald-900">{stats.present}</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <div className="font-medium text-amber-600">Late</div>
          <div className="text-2xl font-bold text-amber-900">{stats.late}</div>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
          <div className="font-medium text-rose-600">Absent</div>
          <div className="text-2xl font-bold text-rose-900">{stats.absent}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="border-b border-slate-200 bg-slate-50 p-4 text-center text-slate-500">
            Loading attendance data...
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 p-4 text-center text-rose-700">
            {error.message}
          </div>
        ) : null}

        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-6 py-4 font-medium text-slate-500">Employee</th>
              <th className="px-6 py-4 font-medium text-slate-500">Status</th>
              <th className="px-6 py-4 font-medium text-slate-500">Check In</th>
              <th className="px-6 py-4 font-medium text-slate-500">Check Out</th>
              <th className="px-6 py-4 font-medium text-slate-500">Correction</th>
              <th className="px-6 py-4 text-right font-medium text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.map((user) => {
              const record = attendanceByUid[user.uid];
              const present = (record?.status ?? "").toLowerCase();
              const isPresent =
                present === "present" ||
                present === "checked_in" ||
                present === "checked_out" ||
                present === "on_break";
              const isLate = record?.late || (record?.dayStatus ?? "").toLowerCase() === "late";
              const statusLabel = isPresent
                ? isLate
                  ? "Late"
                  : present === "on_break"
                    ? "On Break"
                    : present === "checked_out"
                      ? "Checked Out"
                      : "Present"
                : present === "on_leave"
                  ? "On Leave"
                  : "Absent";
              const pendingAudit = pendingOverrideByUser.get(user.uid) ?? null;
              return (
                <tr key={user.uid} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{user.displayName}</div>
                    <div className="mt-1">
                      <RoleBadge role={user.orgRole ?? user.role} />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {isPresent ? (
                      <span
                        className={`rounded px-2 py-1 text-xs font-medium ${isLate ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                      >
                        {statusLabel}
                      </span>
                    ) : (
                      <span className="rounded bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800">
                        {statusLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {formatAttendanceTime(record?.checkedInAt ?? record?.checkInTime)}
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {formatAttendanceTime(record?.checkedOutAt ?? record?.checkOutTime)}
                  </td>
                  <td className="px-6 py-4">
                    {record?.correctionStatus ? (
                      <div className="space-y-1">
                        <span
                          className={`inline-flex rounded px-2 py-1 text-xs font-medium ${getCorrectionTone(record.correctionStatus)}`}
                        >
                          {record.correctionStatus === "pending_hr_review"
                            ? "Pending HR review"
                            : record.correctionStatus}
                        </span>
                        <div className="max-w-xs text-xs text-slate-500">
                          {record.correctionReason ?? "No correction reason"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {canEditAttendance ? (
                        <button
                          onClick={() => openEdit(user)}
                          className="font-medium text-indigo-600 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                      ) : null}
                      {canReviewCorrections && pendingAudit ? (
                        <>
                          <button
                            onClick={() => void handleReview(pendingAudit, "approved")}
                            disabled={reviewingId === pendingAudit.id}
                            className="rounded border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => void handleReview(pendingAudit, "rejected")}
                            disabled={reviewingId === pendingAudit.id}
                            className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && !error && filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-500">
                  No employees matched the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Attendance override audit trail</h2>
          <span className="text-xs text-slate-500">{overrideAuditRows.length} events</span>
        </div>
        <div className="space-y-2">
          {overrideAuditRows.slice(0, 25).map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2 text-slate-700">
                <span className="font-semibold">{getAuditActionLabel(row)}</span>
                <span className="text-slate-400">for</span>
                <span>{row.uid}</span>
                <span className={`rounded px-2 py-0.5 ${getCorrectionTone(row.correctionStatus)}`}>
                  {row.correctionStatus}
                </span>
              </div>
              <div className="text-right text-slate-500">
                <div>{row.reason}</div>
                <div>
                  {row.actor.name ?? row.actor.uid} | {new Date(toMillis(row.createdAt)).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {overrideAuditRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              No attendance correction events for this date.
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={isEditOpen} onClose={() => setIsEditOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <Dialog.Title className="mb-4 text-lg font-bold">Edit Attendance</Dialog.Title>
            <div className="mb-4">
              <div className="mb-1 text-sm text-slate-500">Employee</div>
              <div className="font-medium">{selectedUser?.displayName}</div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                <select
                  className="w-full rounded border p-2"
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value)}
                >
                  {canReviewCorrections ? (
                    <>
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="checked_in">Checked In</option>
                      <option value="checked_out">Checked Out</option>
                      <option value="absent">Absent</option>
                      <option value="on_leave">On Leave</option>
                    </>
                  ) : (
                    <option value="absent">Absent (manager override)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Check In Time</label>
                <input
                  type="time"
                  className="w-full rounded border p-2"
                  value={editTime}
                  onChange={(event) => setEditTime(event.target.value)}
                  disabled={editStatus === "absent" || editStatus === "on_leave"}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reason (mandatory)
                </label>
                <textarea
                  className="w-full rounded border p-2 text-sm"
                  rows={3}
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  placeholder={
                    canReviewCorrections
                      ? "Explain correction and supporting context."
                      : "Why should this record be marked absent?"
                  }
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsEditOpen(false)}
                className="rounded px-4 py-2 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={updating}
                className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {updating ? "Updating..." : "Update"}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}
