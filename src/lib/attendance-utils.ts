import { AttendanceDayDoc, AttendanceSession, PresenceDoc } from "@/lib/types/attendance";

export function toDateSafe(x: unknown): Date {
  if (x instanceof Date) return x;
  const maybe = x as { toDate?: () => Date; seconds?: number };
  if (typeof maybe?.toDate === "function") return maybe.toDate();
  if (typeof maybe?.seconds === "number") return new Date(maybe.seconds * 1000);
  if (typeof x === "number" || typeof x === "string") return new Date(x);
  return new Date(NaN);
}

export function calculateActiveMinutes(
  record: PresenceDoc | AttendanceDayDoc | null | undefined,
  now = new Date()
): number {
  if (!record) return 0;

  if (record.sessions && Array.isArray(record.sessions) && record.sessions.length > 0) {
    return calculateSessionMinutes(record.sessions, now);
  }

  if (!record.checkedInAt) return 0;

  const start = toDateSafe(record.checkedInAt);
  const end = record.checkedOutAt ? toDateSafe(record.checkedOutAt) : now;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  let totalMs = Math.max(0, end.getTime() - start.getTime());

  if (record.breaks && Array.isArray(record.breaks)) {
    for (const b of record.breaks) {
      const bStart = toDateSafe(b.start);
      const bEnd = b.end ? toDateSafe(b.end) : end;

      if (!isNaN(bStart.getTime()) && !isNaN(bEnd.getTime())) {
        const breakMs = Math.max(0, bEnd.getTime() - bStart.getTime());
        totalMs -= breakMs;
      }
    }
  }

  return Math.max(0, Math.floor(totalMs / 60000));
}

function calculateSessionMinutes(sessions: AttendanceSession[], now: Date) {
  let totalMs = 0;

  sessions.forEach((session) => {
    const start = toDateSafe(session.checkedInAt);
    const end = session.checkedOutAt ? toDateSafe(session.checkedOutAt) : now;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    let sessionMs = Math.max(0, end.getTime() - start.getTime());
    if (session.breaks && Array.isArray(session.breaks)) {
      session.breaks.forEach((breakSession) => {
        const breakStart = toDateSafe(breakSession.start);
        const breakEnd = breakSession.end ? toDateSafe(breakSession.end) : end;
        if (isNaN(breakStart.getTime()) || isNaN(breakEnd.getTime())) return;
        sessionMs -= Math.max(0, breakEnd.getTime() - breakStart.getTime());
      });
    }

    totalMs += Math.max(0, sessionMs);
  });

  return Math.max(0, Math.floor(totalMs / 60000));
}

export function getAttendanceSessionCount(
  record: PresenceDoc | AttendanceDayDoc | null | undefined,
) {
  if (!record) return 0;
  if (typeof record.sessionCount === "number") return record.sessionCount;
  if (record.sessions && Array.isArray(record.sessions)) return record.sessions.length;
  return record.checkedInAt ? 1 : 0;
}

export function getAttendancePunchCounts(
  record: PresenceDoc | AttendanceDayDoc | null | undefined,
) {
  if (!record) return { checkIns: 0, checkOuts: 0 };
  if (typeof record.checkInCount === "number" || typeof record.checkOutCount === "number") {
    return {
      checkIns: Math.max(0, Number(record.checkInCount) || 0),
      checkOuts: Math.max(0, Number(record.checkOutCount) || 0),
    };
  }
  if (record.sessions && Array.isArray(record.sessions)) {
    return {
      checkIns: record.sessions.length,
      checkOuts: record.sessions.filter((session) => Boolean(session.checkedOutAt)).length,
    };
  }
  return {
    checkIns: record.checkedInAt ? 1 : 0,
    checkOuts: record.checkedOutAt ? 1 : 0,
  };
}
