import "server-only";

import {
  FieldValue,
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import type { AttendanceSession, BreakSession, GeoLocation } from "@/lib/types/attendance";
import type { UserDoc } from "@/lib/types/user";

const DEFAULT_ATTENDANCE_TIME_ZONE = "Asia/Kolkata";
const DEFAULT_SHIFT_START_MINUTES = 11 * 60 + 10;
const DEFAULT_AUTO_CHECKOUT_HOUR = 20;

export type AttendanceAction =
  | "check_in"
  | "check_out"
  | "start_break"
  | "end_break"
  | "mark_on_leave"
  | "attach_location";

type AttendanceActionInput = {
  action: AttendanceAction;
  location?: GeoLocation;
};

type AutoCheckoutSummary = {
  success: boolean;
  processed: number;
  skipped: number;
  errors: string[];
  timestamp: string;
  message?: string;
};

function getAttendanceTimeZone() {
  return process.env.ATTENDANCE_TIME_ZONE?.trim() || DEFAULT_ATTENDANCE_TIME_ZONE;
}

function getDatePartsInTimeZone(date: Date, timeZone = getAttendanceTimeZone()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function zonedDateTimeToDate(
  input: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute?: number;
    second?: number;
  },
  timeZone = getAttendanceTimeZone(),
) {
  let candidate = new Date(
    Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute ?? 0,
      input.second ?? 0,
      0,
    ),
  );

  for (let index = 0; index < 4; index += 1) {
    const actual = getDatePartsInTimeZone(candidate, timeZone);
    const desiredLocalTime = Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute ?? 0,
      input.second ?? 0,
      0,
    );
    const actualLocalTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const diff = desiredLocalTime - actualLocalTime;
    if (diff === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + diff);
  }

  return candidate;
}

export function getAttendanceDateKey(now = new Date(), timeZone = getAttendanceTimeZone()) {
  const parts = getDatePartsInTimeZone(now, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getAttendanceMinutes(now = new Date(), timeZone = getAttendanceTimeZone()) {
  const parts = getDatePartsInTimeZone(now, timeZone);
  return parts.hour * 60 + parts.minute;
}

function splitDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error("Invalid attendance date.");
  }
  return { year, month, day };
}

function getPresenceRef(adminDb: Firestore, uid: string) {
  return adminDb.collection("presence").doc(uid);
}

function getDayRef(adminDb: Firestore, uid: string, dateKey: string) {
  const { year, month } = splitDateKey(dateKey);
  return adminDb
    .collection("users")
    .doc(uid)
    .collection("attendance")
    .doc(String(year))
    .collection("months")
    .doc(String(month).padStart(2, "0"))
    .collection("days")
    .doc(dateKey);
}

function normalizeBreaks(value: unknown): BreakSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => Boolean(entry && typeof entry === "object")) as BreakSession[];
}

function normalizeSessions(value: unknown): AttendanceSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => Boolean(entry && typeof entry === "object")) as AttendanceSession[];
}

function deriveSessionsFromLegacyRecord(
  source: Record<string, unknown> | undefined,
  breaks: BreakSession[],
) {
  if (!source?.checkedInAt) return [] as AttendanceSession[];
  return [
    {
      checkedInAt: source.checkedInAt,
      checkedOutAt: source.checkedOutAt ?? null,
      breaks,
    },
  ];
}

function resolveStoredCount(
  primary: unknown,
  fallback: unknown,
  derivedValue: number,
) {
  if (typeof primary === "number") return primary;
  if (typeof fallback === "number") return fallback;
  return derivedValue;
}

function validateLocation(location: GeoLocation | undefined): GeoLocation {
  if (!location) {
    throw new Error("Location is required.");
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const accuracy =
    location.accuracy == null ? null : Math.max(0, Number(location.accuracy) || 0);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Invalid location coordinates.");
  }

  return {
    lat,
    lng,
    accuracy,
    ...(typeof location.timestamp === "number" ? { timestamp: location.timestamp } : {}),
  };
}

function closeTrailingBreak(breaks: BreakSession[], endedAt: Timestamp) {
  if (breaks.length === 0) return breaks;

  const updatedBreaks = [...breaks];
  const lastBreak = updatedBreaks[updatedBreaks.length - 1];
  if (!lastBreak?.end) {
    updatedBreaks[updatedBreaks.length - 1] = {
      ...lastBreak,
      end: endedAt,
    };
  }
  return updatedBreaks;
}

function getCurrentSessionBreaks(sessions: AttendanceSession[]) {
  if (sessions.length === 0) return [] as BreakSession[];
  return normalizeBreaks(sessions[sessions.length - 1]?.breaks);
}

function closeTrailingSession(
  sessions: AttendanceSession[],
  endedAt: Timestamp,
  breaks: BreakSession[],
) {
  if (sessions.length === 0) return sessions;

  const updatedSessions = [...sessions];
  const lastSession = updatedSessions[updatedSessions.length - 1];
  if (!lastSession) return updatedSessions;

  updatedSessions[updatedSessions.length - 1] = {
    ...lastSession,
    checkedOutAt: endedAt,
    breaks,
  };
  return updatedSessions;
}

function appendSession(sessions: AttendanceSession[], checkedInAt: Timestamp) {
  return [
    ...sessions,
    {
      checkedInAt,
      checkedOutAt: null,
      breaks: [],
    },
  ];
}

function updateActiveSessionBreaks(
  sessions: AttendanceSession[],
  breaks: BreakSession[],
) {
  if (sessions.length === 0) return sessions;
  const updatedSessions = [...sessions];
  const lastSession = updatedSessions[updatedSessions.length - 1];
  if (!lastSession) return updatedSessions;
  updatedSessions[updatedSessions.length - 1] = {
    ...lastSession,
    breaks,
  };
  return updatedSessions;
}

function applyAttendancePatch(args: {
  tx: Transaction;
  adminDb: Firestore;
  uid: string;
  dateKey: string;
  existingDayData: Record<string, unknown> | undefined;
  patch: {
    status: string;
    dayStatus?: string | null;
    checkedInAt?: Timestamp | null;
    checkedOutAt?: Timestamp | null;
    breaks?: BreakSession[];
    sessions?: AttendanceSession[];
    sessionCount?: number;
    checkInCount?: number;
    checkOutCount?: number;
    location?: GeoLocation | null;
    autoCheckout?: boolean;
  };
}) {
  const { tx, adminDb, uid, dateKey, existingDayData, patch } = args;
  const presenceRef = getPresenceRef(adminDb, uid);
  const dayRef = getDayRef(adminDb, uid, dateKey);
  const createdAt = existingDayData?.createdAt ?? FieldValue.serverTimestamp();

  const base = {
    uid,
    dateKey,
    status: patch.status,
    updatedAt: FieldValue.serverTimestamp(),
    ...(typeof patch.dayStatus !== "undefined" ? { dayStatus: patch.dayStatus } : {}),
    ...(typeof patch.breaks !== "undefined" ? { breaks: patch.breaks } : {}),
    ...(typeof patch.sessions !== "undefined" ? { sessions: patch.sessions } : {}),
    ...(typeof patch.sessionCount !== "undefined" ? { sessionCount: patch.sessionCount } : {}),
    ...(typeof patch.checkInCount !== "undefined" ? { checkInCount: patch.checkInCount } : {}),
    ...(typeof patch.checkOutCount !== "undefined" ? { checkOutCount: patch.checkOutCount } : {}),
    ...(typeof patch.location !== "undefined" ? { location: patch.location } : {}),
    ...(typeof patch.autoCheckout !== "undefined" ? { autoCheckout: patch.autoCheckout } : {}),
  };

  tx.set(
    presenceRef,
    {
      ...base,
      ...(typeof patch.checkedInAt !== "undefined"
        ? { checkedInAt: patch.checkedInAt }
        : {}),
      ...(typeof patch.checkedOutAt !== "undefined"
        ? { checkedOutAt: patch.checkedOutAt }
        : {}),
    },
    { merge: true },
  );

  tx.set(
    dayRef,
    {
      ...base,
      createdAt,
      ...(typeof patch.checkedInAt !== "undefined"
        ? { checkedInAt: patch.checkedInAt }
        : {}),
      ...(typeof patch.checkedOutAt !== "undefined"
        ? { checkedOutAt: patch.checkedOutAt }
        : {}),
    },
    { merge: true },
  );
}

async function notifyAttendanceStakeholders(
  adminDb: Firestore,
  user: UserDoc,
  eventType: "check_in" | "check_out",
  occurredAt: Date,
) {
  const reportingManagerId = getEffectiveReportsToUid(user);
  const recipientUids = new Set<string>();
  if (user.assignedHR) recipientUids.add(user.assignedHR);
  if (reportingManagerId) recipientUids.add(reportingManagerId);
  recipientUids.delete(user.uid);
  if (recipientUids.size === 0) return;

  const actorLabel = user.displayName?.trim() || user.email?.trim() || user.uid;
  const timeLabel = occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLabel = occurredAt.toLocaleDateString();
  const title =
    eventType === "check_in"
      ? `Attendance: ${actorLabel} checked in`
      : `Attendance: ${actorLabel} checked out`;
  const body =
    eventType === "check_in"
      ? `${actorLabel} checked in at ${timeLabel} on ${dateLabel}.`
      : `${actorLabel} checked out at ${timeLabel} on ${dateLabel}.`;

  await Promise.all(
    Array.from(recipientUids).map((recipientUid) =>
      adminDb.collection("notifications").doc().set({
        recipientUid,
        title,
        body,
        read: false,
        priority: "medium",
        createdAt: FieldValue.serverTimestamp(),
        type: "attendance_event",
        attendanceEventType: eventType,
        actorUid: user.uid,
        actorName: actorLabel,
      }),
    ),
  );
}

export async function performAttendanceAction(
  adminDb: Firestore,
  user: UserDoc,
  input: AttendanceActionInput,
) {
  const timeZone = getAttendanceTimeZone();
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const todayKey = getAttendanceDateKey(now, timeZone);
  let notifyEvent: "check_in" | "check_out" | null = null;
  let notifyAt = now;

  await adminDb.runTransaction(async (tx) => {
    const presenceRef = getPresenceRef(adminDb, user.uid);
    const dayRef = getDayRef(adminDb, user.uid, todayKey);
    const [presenceSnap, daySnap] = await Promise.all([tx.get(presenceRef), tx.get(dayRef)]);
    const existingPresence = presenceSnap.exists ? presenceSnap.data() : undefined;
    const existingDay = daySnap.exists ? daySnap.data() : undefined;
    const presenceForToday =
      String(existingPresence?.dateKey ?? "") === todayKey ? existingPresence : undefined;
    const currentRecord = presenceForToday ?? existingDay;
    const hasTodayRecord = Boolean(currentRecord);
    const currentStatus = String(currentRecord?.status ?? "");
    const legacyBreaks = normalizeBreaks(currentRecord?.breaks);
    const existingSessionsRaw = normalizeSessions(currentRecord?.sessions);
    const existingSessions =
      existingSessionsRaw.length > 0
        ? existingSessionsRaw
        : deriveSessionsFromLegacyRecord(currentRecord, legacyBreaks);
    const currentBreaks =
      existingSessionsRaw.length > 0
        ? getCurrentSessionBreaks(existingSessions)
        : legacyBreaks;
    const checkInCount = resolveStoredCount(
      currentRecord?.checkInCount,
      undefined,
      existingSessions.length,
    );
    const checkOutCount = resolveStoredCount(
      currentRecord?.checkOutCount,
      undefined,
      existingSessions.filter((session) => Boolean(session.checkedOutAt)).length,
    );

    switch (input.action) {
      case "check_in": {
        if (currentStatus === "checked_in" || currentStatus === "on_break") {
          return;
        }
        if (currentStatus === "on_leave") {
          throw new Error("You are marked on leave for today.");
        }
        if (currentStatus === "absent") {
          throw new Error("Your attendance is already marked absent for today. Contact HR.");
        }

        const existingDayStatus =
          typeof currentRecord?.dayStatus === "string"
            ? currentRecord.dayStatus
            : undefined;
        const dayStatus =
          existingDayStatus ??
          (getAttendanceMinutes(now, timeZone) > DEFAULT_SHIFT_START_MINUTES
            ? "late"
            : "present");
        const sessions = appendSession(existingSessions, nowTimestamp);
        const firstCheckIn =
          currentRecord?.checkedInAt ??
          sessions[0]?.checkedInAt ??
          nowTimestamp;

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: "checked_in",
            dayStatus,
            checkedInAt: firstCheckIn as Timestamp,
            checkedOutAt: null,
            breaks: [],
            sessions,
            sessionCount: sessions.length,
            checkInCount: checkInCount + 1,
            checkOutCount,
            location: null,
            autoCheckout: false,
          },
        });
        notifyEvent = "check_in";
        notifyAt = now;
        return;
      }

      case "check_out": {
        if (!hasTodayRecord || (currentStatus !== "checked_in" && currentStatus !== "on_break")) {
          throw new Error("You are not checked in.");
        }
        const breaks = closeTrailingBreak(currentBreaks, nowTimestamp);
        const sessions = closeTrailingSession(existingSessions, nowTimestamp, breaks);

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: "checked_out",
            checkedOutAt: nowTimestamp,
            breaks,
            sessions,
            sessionCount: sessions.length,
            checkInCount,
            checkOutCount: checkOutCount + 1,
            autoCheckout: false,
          },
        });
        notifyEvent = "check_out";
        notifyAt = now;
        return;
      }

      case "start_break": {
        if (!hasTodayRecord) {
          throw new Error("You must check in first.");
        }
        if (currentStatus === "on_break") {
          throw new Error("You are already on a break.");
        }
        if (currentStatus !== "checked_in") {
          throw new Error("You must be checked in to take a break.");
        }
        const breaks = [...currentBreaks, { start: nowTimestamp }];
        const sessions = updateActiveSessionBreaks(existingSessions, breaks);

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: "on_break",
            breaks,
            sessions,
            sessionCount: sessions.length,
            checkInCount,
            checkOutCount,
            autoCheckout: false,
          },
        });
        return;
      }

      case "end_break": {
        if (!hasTodayRecord) {
          throw new Error("No active session found.");
        }
        if (currentStatus !== "on_break") {
          throw new Error("You are not on a break.");
        }
        const breaks = closeTrailingBreak(currentBreaks, nowTimestamp);
        const sessions = updateActiveSessionBreaks(existingSessions, breaks);

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: "checked_in",
            breaks,
            sessions,
            sessionCount: sessions.length,
            checkInCount,
            checkOutCount,
            autoCheckout: false,
          },
        });
        return;
      }

      case "mark_on_leave": {
        if (hasTodayRecord && ["checked_in", "on_break", "checked_out", "absent"].includes(currentStatus)) {
          throw new Error("Attendance already exists for today. Contact HR for corrections.");
        }
        if (currentStatus === "on_leave") {
          return;
        }

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: "on_leave",
            dayStatus: "on_leave",
            checkedInAt: null,
            checkedOutAt: null,
            breaks: [],
            sessions: [],
            sessionCount: 0,
            checkInCount: 0,
            checkOutCount: 0,
            location: null,
            autoCheckout: false,
          },
        });
        return;
      }

      case "attach_location": {
        if (!hasTodayRecord) {
          throw new Error("No attendance record for today.");
        }

        applyAttendancePatch({
          tx,
          adminDb,
          uid: user.uid,
          dateKey: todayKey,
          existingDayData: existingDay,
          patch: {
            status: currentStatus,
            dayStatus:
              typeof currentRecord?.dayStatus === "string"
                ? currentRecord.dayStatus
                : undefined,
            sessions: existingSessions,
            sessionCount:
              typeof currentRecord?.sessionCount === "number"
                ? currentRecord.sessionCount
                  : existingSessions.length,
            checkInCount,
            checkOutCount,
            location: validateLocation(input.location),
          },
        });
        return;
      }

      default:
        throw new Error("Unsupported attendance action.");
    }
  });

  if (notifyEvent) {
    try {
      await notifyAttendanceStakeholders(adminDb, user, notifyEvent, notifyAt);
    } catch (notifyError) {
      console.error("Attendance notification failed", notifyError);
    }
  }

  return {
    success: true,
    dateKey: todayKey,
    action: input.action,
  };
}

export async function syncTodayPresenceFromAttendanceRecord(
  adminDb: Firestore,
  uid: string,
  dateKey: string,
  patch: Record<string, unknown>,
) {
  if (dateKey !== getAttendanceDateKey()) return;

  const allowedKeys = [
    "status",
    "dayStatus",
    "checkedInAt",
    "checkInTime",
    "checkedOutAt",
    "checkOutTime",
    "sessions",
    "sessionCount",
    "checkInCount",
    "checkOutCount",
    "manualUpdate",
    "updatedAt",
    "late",
    "correctionStatus",
    "correctionReason",
    "correctionRequestedBy",
    "correctionRequestedAt",
    "correctionReviewedBy",
    "correctionReviewedAt",
    "correctionReviewReason",
    "latestOverrideAuditId",
  ] as const;

  const normalizedPatch: Record<string, unknown> = {
    uid,
    dateKey,
  };

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const value = patch[key];
    switch (key) {
      case "checkInTime":
        if (!Object.prototype.hasOwnProperty.call(patch, "checkedInAt")) {
          normalizedPatch.checkedInAt = value ?? null;
        }
        break;
      case "checkOutTime":
        if (!Object.prototype.hasOwnProperty.call(patch, "checkedOutAt")) {
          normalizedPatch.checkedOutAt = value ?? null;
        }
        break;
      case "late":
        break;
      default:
        normalizedPatch[key] = value;
    }
  });

  if (
    normalizedPatch.status === "checked_in" &&
    !Object.prototype.hasOwnProperty.call(normalizedPatch, "checkedOutAt")
  ) {
    normalizedPatch.checkedOutAt = null;
  }

  if (
    normalizedPatch.status === "on_leave" ||
    normalizedPatch.status === "absent"
  ) {
    normalizedPatch.checkedInAt = null;
    normalizedPatch.checkedOutAt = null;
  }

  normalizedPatch.updatedAt = FieldValue.serverTimestamp();
  await getPresenceRef(adminDb, uid).set(normalizedPatch, { merge: true });
}

export async function runAutoCheckout(
  adminDb: Firestore,
  now = new Date(),
): Promise<AutoCheckoutSummary> {
  const timeZone = getAttendanceTimeZone();
  const todayKey = getAttendanceDateKey(now, timeZone);
  const nowMinutes = getAttendanceMinutes(now, timeZone);
  const cutoffMinutes = DEFAULT_AUTO_CHECKOUT_HOUR * 60;

  if (nowMinutes < cutoffMinutes) {
    return {
      success: true,
      processed: 0,
      skipped: 0,
      errors: [],
      timestamp: now.toISOString(),
      message: "Auto-checkout skipped before the configured cutoff time.",
    };
  }

  const snapshot = await adminDb
    .collection("presence")
    .where("status", "in", ["checked_in", "on_break"])
    .get();

  if (snapshot.empty) {
    return {
      success: true,
      processed: 0,
      skipped: 0,
      errors: [],
      timestamp: now.toISOString(),
      message: "No active check-ins found to auto-checkout.",
    };
  }

  const batch = adminDb.batch();
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of snapshot.docs) {
    try {
      const data = row.data();
      const uid = String(data.uid ?? row.id);
      const dateKey = String(data.dateKey ?? "");
      if (!uid || !dateKey) {
        skipped += 1;
        continue;
      }
      if (dateKey > todayKey) {
        skipped += 1;
        continue;
      }

      const { year, month, day } = splitDateKey(dateKey);
      const checkoutDate = zonedDateTimeToDate(
        { year, month, day, hour: DEFAULT_AUTO_CHECKOUT_HOUR, minute: 0, second: 0 },
        timeZone,
      );
      if (checkoutDate.getTime() > now.getTime()) {
        skipped += 1;
        continue;
      }

      const checkoutTimestamp = Timestamp.fromDate(checkoutDate);
      const existingSessionsRaw = normalizeSessions(data.sessions);
      const legacyBreaks = normalizeBreaks(data.breaks);
      const existingSessions =
        existingSessionsRaw.length > 0
          ? existingSessionsRaw
          : deriveSessionsFromLegacyRecord(data as Record<string, unknown>, legacyBreaks);
      const currentBreaks =
        existingSessionsRaw.length > 0
          ? getCurrentSessionBreaks(existingSessions)
          : legacyBreaks;
      const breaks = closeTrailingBreak(currentBreaks, checkoutTimestamp);
      const sessions = closeTrailingSession(
        existingSessions,
        checkoutTimestamp,
        breaks,
      );
      const updates = {
        status: "checked_out",
        checkedOutAt: checkoutTimestamp,
        breaks,
        sessions,
        sessionCount: sessions.length,
        checkInCount:
          typeof data.checkInCount === "number" ? data.checkInCount : sessions.length,
        checkOutCount:
          typeof data.checkOutCount === "number"
            ? data.checkOutCount + 1
            : sessions.filter((session) => Boolean(session.checkedOutAt)).length,
        autoCheckout: true,
        updatedAt: FieldValue.serverTimestamp(),
      };

      batch.set(row.ref, updates, { merge: true });
      batch.set(getDayRef(adminDb, uid, dateKey), updates, { merge: true });

      const userSnap = await adminDb.collection("users").doc(uid).get();
      if (userSnap.exists) {
        const user = ({ ...(userSnap.data() as UserDoc), uid } as UserDoc);
        const reportingManagerId = getEffectiveReportsToUid(user);
        const recipients = new Set<string>();
        if (user.assignedHR) recipients.add(user.assignedHR);
        if (reportingManagerId) recipients.add(reportingManagerId);
        recipients.delete(uid);

        const actorLabel = user.displayName || user.email || uid;
        const timeLabel = checkoutDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateLabel = checkoutDate.toLocaleDateString();

        for (const recipientUid of recipients) {
          batch.set(adminDb.collection("notifications").doc(), {
            recipientUid,
            title: `Attendance: ${actorLabel} auto checked out`,
            body: `${actorLabel} auto checked out at ${timeLabel} on ${dateLabel}.`,
            read: false,
            priority: "medium",
            type: "attendance_event",
            attendanceEventType: "check_out",
            actorUid: uid,
            actorName: actorLabel,
            autoCheckout: true,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown auto-checkout error";
      errors.push(`User ${row.id}: ${message}`);
    }
  }

  if (processed > 0) {
    await batch.commit();
  }

  return {
    success: true,
    processed,
    skipped,
    errors,
    timestamp: now.toISOString(),
  };
}
