export function normalizeAttendanceStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase();
}

export function isPresentAttendanceStatus(status: string | null | undefined) {
  const normalized = normalizeAttendanceStatus(status);
  return (
    normalized === "present" ||
    normalized === "late" ||
    normalized === "checked_in" ||
    normalized === "checked_out" ||
    normalized === "on_break"
  );
}

export function isOnLeaveAttendanceState(
  status: string | null | undefined,
  dayStatus?: string | null | undefined,
) {
  return (
    normalizeAttendanceStatus(status) === "on_leave" ||
    normalizeAttendanceStatus(dayStatus) === "on_leave"
  );
}

export function isAbsentAttendanceState(
  status: string | null | undefined,
  dayStatus?: string | null | undefined,
) {
  return (
    normalizeAttendanceStatus(status) === "absent" ||
    normalizeAttendanceStatus(dayStatus) === "absent"
  );
}

export function isPresentAttendanceRecord(record: {
  status?: string | null | undefined;
  dayStatus?: string | null | undefined;
} | null | undefined) {
  if (!record) return false;
  if (isOnLeaveAttendanceState(record.status, record.dayStatus)) return false;

  const normalizedDayStatus = normalizeAttendanceStatus(record.dayStatus);
  if (normalizedDayStatus === "present" || normalizedDayStatus === "late") {
    return true;
  }

  return isPresentAttendanceStatus(record.status);
}
