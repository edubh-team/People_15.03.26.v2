import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import { db } from "@/lib/firebase/client";
import { calculateLeaveRangeBreakdown } from "@/lib/attendance/leave-policy";
import type {
  AttendanceDayDoc,
  AttendanceDayStatus,
  BreakSession,
  GeoLocation,
  HolidayDoc,
  LeaveBalanceDoc,
  LeaveRequestDoc,
  PresenceDoc,
  PresenceStatus,
} from "@/lib/types/attendance";
import type { UserDoc } from "@/lib/types/user";

export function getTodayKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function splitDateKey(dateKey: string) {
  const [yyyy, mm] = dateKey.split("-");
  return { yyyy: yyyy ?? "0000", mm: mm ?? "01" };
}

function daysCollection(uid: string, yyyy: string, mm: string) {
  return collection(db!, "users", uid, "attendance", yyyy, "months", mm, "days");
}

function dayDoc(uid: string, dateKey: string) {
  const { yyyy, mm } = splitDateKey(dateKey);
  return doc(db!, "users", uid, "attendance", yyyy, "months", mm, "days", dateKey);
}

export async function getMyPresence(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "presence", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as PresenceDoc;
}

export async function getRecentAttendanceDays(uid: string, days = 14) {
  if (!db) throw new Error("Firebase is not configured");
  const now = new Date();
  const monthsToFetch: Array<{ year: number; monthIndex0: number }> = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthsToFetch.push({ year: d.getFullYear(), monthIndex0: d.getMonth() });
  }

  const all = (
    await Promise.all(
      monthsToFetch.map((m) => getAttendanceDaysForMonth(uid, m.year, m.monthIndex0)),
    )
  ).flat();

  all.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return all.slice(0, days);
}

export async function getAttendanceDaysForMonth(uid: string, year: number, monthIndex0: number) {
  if (!db) throw new Error("Firebase is not configured");
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const q = query(daysCollection(uid, String(year), mm), orderBy("dateKey", "asc"), limit(62));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AttendanceDayDoc);
}

export async function getAttendanceDaysForYear(uid: string, year: number) {
  if (!db) throw new Error("Firebase is not configured");
  const all: AttendanceDayDoc[] = [];
  for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
    const part = await getAttendanceDaysForMonth(uid, year, monthIndex0);
    all.push(...part);
  }
  return all;
}

export async function getHolidaysForMonth(year: number, monthIndex0: number) {
  if (!db) throw new Error("Firebase is not configured");
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const startKey = `${year}-${mm}-01`;
  const endKey = `${year}-${mm}-31`;
  const q = query(
    collection(db, "holidays"),
    where("dateKey", ">=", startKey),
    where("dateKey", "<=", endKey),
    orderBy("dateKey", "asc"),
    limit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as HolidayDoc);
}

export async function getApprovedLeaveRequests(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const q = query(
    collection(db, "leaveRequests"),
    where("uid", "==", uid),
    where("status", "==", "approved"),
    limit(200),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as LeaveRequestDoc);
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && value !== null) {
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

export async function getMyLeaveRequests(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const q = query(collection(db, "leaveRequests"), where("uid", "==", uid), limit(200));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as LeaveRequestDoc)
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
}

export async function getLeaveBalance(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "leaveBalances", uid);
  const snap = await getDoc(ref);
  
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const DEFAULT_MONTHLY_PTO = 1;

  if (!snap.exists()) {
    const data: LeaveBalanceDoc = {
      uid,
      ptoRemaining: DEFAULT_MONTHLY_PTO,
      lastResetMonth: currentMonthKey,
      updatedAt: serverTimestamp(),
    } as unknown as LeaveBalanceDoc;
    await setDoc(ref, data);
    return data;
  }

  const data = snap.data() as LeaveBalanceDoc;
  if (data.lastResetMonth !== currentMonthKey) {
    const updates = {
      ptoRemaining: DEFAULT_MONTHLY_PTO,
      lastResetMonth: currentMonthKey,
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, updates, { merge: true });
    return { ...data, ...updates } as LeaveBalanceDoc;
  }

  return data;
}

export async function applyForLeave(input: {
  uid: string;
  startDateKey: string;
  endDateKey: string;
  reason: string;
  type: LeaveRequestDoc["type"];
  attachmentUrl?: string;
  assignedHR?: string | null;
  reportingManagerId?: string | null;
  requesterRole?: string | null;
  includeSaturdayAsLeave?: boolean;
}) {
  if (!db) throw new Error("Firebase is not configured");
  const {
    uid,
    startDateKey,
    endDateKey,
    reason,
    type,
    attachmentUrl,
    assignedHR,
    reportingManagerId,
    requesterRole,
    includeSaturdayAsLeave,
  } = input;

  const today = getTodayKey();
  if (startDateKey <= today) {
    throw new Error("Leave must be for a future date.");
  }

  const includeSaturday = includeSaturdayAsLeave === true;
  const breakdown = calculateLeaveRangeBreakdown(startDateKey, endDateKey, {
    includeSaturdayAsLeave: includeSaturday,
  });
  const initialStatus: LeaveRequestDoc["status"] = assignedHR
    ? "pending_hr"
    : reportingManagerId
      ? "pending_manager"
      : "pending";

  const docRef = doc(collection(db, "leaveRequests"));
  await setDoc(docRef, {
    uid,
    startDateKey,
    endDateKey,
    type,
    status: initialStatus,
    requesterRole: requesterRole ?? null,
    reportingManagerId: reportingManagerId ?? null,
    includeSaturdayAsLeave: includeSaturday,
    weekendPolicy: {
      saturday: "optional_off",
      sunday: "mandatory_off",
      includeSaturdayAsLeave: includeSaturday,
    },
    chargeableDays: breakdown.chargeableLeaveDays,
    totalCalendarDays: breakdown.totalCalendarDays,
    saturdayExcludedDays: breakdown.saturdayExcludedDays,
    sundayExcludedDays: breakdown.sundayExcludedDays,
    hrDecision:
      initialStatus === "pending_hr" || initialStatus === "pending"
        ? "pending"
        : "approved",
    managerDecision: reportingManagerId ? "pending" : "approved",
    reason,
    ...(attachmentUrl ? { attachmentUrl } : {}),
    ...(assignedHR ? { assignedHR } : {}),
    ...(reportingManagerId ? { reportingManagerId } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function upsertPresenceAndDay(uid: string, patch: {
  dateKey: string;
  status: PresenceStatus;
  dayStatus?: AttendanceDayStatus;
  location?: GeoLocation | null;
  checkedInAt?: unknown | null;
  checkedOutAt?: unknown | null;
  breaks?: BreakSession[];
}) {
  if (!db) throw new Error("Firebase is not configured");
  const presenceRef = doc(db, "presence", uid);
  const dayRef = dayDoc(uid, patch.dateKey);

  const base = {
    uid,
    dateKey: patch.dateKey,
    status: patch.status,
    ...(typeof patch.dayStatus !== "undefined" ? { dayStatus: patch.dayStatus } : {}),
    ...(typeof patch.location !== "undefined" ? { location: patch.location } : {}),
    ...(typeof patch.breaks !== "undefined" ? { breaks: patch.breaks } : {}),
    updatedAt: serverTimestamp(),
  };

  const presenceData: Partial<PresenceDoc> & {
    uid: string;
    dateKey: string;
    status: PresenceStatus;
    updatedAt: unknown;
  } = {
    ...base,
    ...(typeof patch.checkedInAt !== "undefined"
      ? { checkedInAt: patch.checkedInAt }
      : {}),
    ...(typeof patch.checkedOutAt !== "undefined"
      ? { checkedOutAt: patch.checkedOutAt }
      : {}),
  };

  const dayData: Partial<AttendanceDayDoc> & {
    uid: string;
    dateKey: string;
    status: PresenceStatus;
    createdAt: unknown;
    updatedAt: unknown;
  } = {
    ...base,
    createdAt: serverTimestamp(),
    ...(typeof patch.checkedInAt !== "undefined"
      ? { checkedInAt: patch.checkedInAt }
      : {}),
    ...(typeof patch.checkedOutAt !== "undefined"
      ? { checkedOutAt: patch.checkedOutAt }
      : {}),
  };

  await Promise.all([
    setDoc(presenceRef, presenceData, { merge: true }),
    setDoc(dayRef, dayData, { merge: true }),
  ]);
}

async function notifyAttendanceStakeholders(
  uid: string,
  eventType: "check_in" | "check_out",
  occurredAt: Date,
) {
  if (!db) return;
  const firestore = db;
  const userSnap = await getDoc(doc(firestore, "users", uid));
  if (!userSnap.exists()) return;

  const user = ({ ...(userSnap.data() as UserDoc), uid } as UserDoc);
  const reportingManagerId = getEffectiveReportsToUid(user);
  const recipientUids = new Set<string>();
  if (user.assignedHR) recipientUids.add(user.assignedHR);
  if (reportingManagerId) recipientUids.add(reportingManagerId);
  recipientUids.delete(uid);
  if (recipientUids.size === 0) return;

  const actorLabel = user.displayName?.trim() || user.email?.trim() || uid;
  const timeLabel = occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLabel = occurredAt.toLocaleDateString();
  const title =
    eventType === "check_in" ? `Attendance: ${actorLabel} checked in` : `Attendance: ${actorLabel} checked out`;
  const body =
    eventType === "check_in"
      ? `${actorLabel} checked in at ${timeLabel} on ${dateLabel}.`
      : `${actorLabel} checked out at ${timeLabel} on ${dateLabel}.`;

  await Promise.all(
    Array.from(recipientUids).map((recipientUid) =>
      setDoc(doc(collection(firestore, "notifications")), {
        recipientUid,
        title,
        body,
        read: false,
        priority: "medium",
        createdAt: serverTimestamp(),
        type: "attendance_event",
        attendanceEventType: eventType,
        actorUid: uid,
        actorName: actorLabel,
      }),
    ),
  );
}

export async function checkIn(uid: string) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);
  if (existing && existing.dateKey === dateKey && existing.status === "checked_in") return;
  if (existing && existing.dateKey === dateKey && existing.status === "on_leave") {
    throw new Error("You are marked on leave for today.");
  }
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const shiftStartMinutes = 11 * 60 + 10; // 11:10 AM
  const dayStatus: AttendanceDayStatus = minutes > shiftStartMinutes ? "late" : "present";
  await upsertPresenceAndDay(uid, {
    dateKey,
    status: "checked_in",
    dayStatus,
    checkedInAt: serverTimestamp(),
    checkedOutAt: null,
  });
  try {
    await notifyAttendanceStakeholders(uid, "check_in", new Date());
  } catch (notifyError) {
    console.error("Attendance check-in notification failed", notifyError);
  }
}

export async function checkOut(uid: string) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);

  // Allow checkout if status is "checked_in" OR "on_break"
  if (
    !existing ||
    existing.dateKey !== dateKey ||
    (existing.status !== "checked_in" && existing.status !== "on_break")
  ) {
    throw new Error("You are not checked in.");
  }

  // If currently on break, close the active break session implicitly
  let breaks = existing.breaks;
  if (existing.status === "on_break" && breaks && breaks.length > 0) {
    const lastBreak = breaks[breaks.length - 1];
    if (!lastBreak.end) {
      breaks = [...breaks];
      breaks[breaks.length - 1] = {
        ...lastBreak,
        end: Timestamp.now(),
      };
    }
  }

  await upsertPresenceAndDay(uid, {
    dateKey,
    status: "checked_out",
    checkedOutAt: serverTimestamp(),
    ...(breaks ? { breaks } : {}),
  });
  try {
    await notifyAttendanceStakeholders(uid, "check_out", new Date());
  } catch (notifyError) {
    console.error("Attendance check-out notification failed", notifyError);
  }
}

export async function markOnLeave(uid: string) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);
  if (existing && existing.dateKey === dateKey && existing.status === "checked_in") {
    throw new Error("Check out before marking on leave.");
  }
  await upsertPresenceAndDay(uid, {
    dateKey,
    status: "on_leave",
    dayStatus: "on_leave",
    checkedInAt: null,
    checkedOutAt: null,
  });
}

export async function startBreak(uid: string) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);
  
  if (!existing || existing.dateKey !== dateKey) {
    throw new Error("You must check in first.");
  }
  if (existing.status === "on_break") {
    throw new Error("You are already on a break.");
  }
  if (existing.status !== "checked_in") {
    throw new Error("You must be checked in to take a break.");
  }

  const currentBreaks = existing.breaks || [];
  
  await upsertPresenceAndDay(uid, {
    dateKey,
    status: "on_break",
    breaks: [...currentBreaks, { start: Timestamp.now() }],
  });
}

export async function endBreak(uid: string) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);

  if (!existing || existing.dateKey !== dateKey) {
    throw new Error("No active session found.");
  }
  if (existing.status !== "on_break") {
    throw new Error("You are not on a break.");
  }

  const currentBreaks = existing.breaks || [];
  if (currentBreaks.length === 0) {
    // Should not happen if status is on_break, but handle gracefully
    await upsertPresenceAndDay(uid, {
      dateKey,
      status: "checked_in",
    });
    return;
  }

  const updatedBreaks = [...currentBreaks];
  const lastBreak = updatedBreaks[updatedBreaks.length - 1];
  
  // Close the break
  updatedBreaks[updatedBreaks.length - 1] = {
    ...lastBreak,
    end: Timestamp.now(),
  };

  await upsertPresenceAndDay(uid, {
    dateKey,
    status: "checked_in",
    breaks: updatedBreaks,
  });
}

export async function attachTodayLocation(uid: string, location: GeoLocation) {
  const dateKey = getTodayKey();
  const existing = await getMyPresence(uid);
  if (!existing || existing.dateKey !== dateKey) {
    throw new Error("No attendance record for today.");
  }
  await upsertPresenceAndDay(uid, {
    dateKey,
    status: existing.status,
    dayStatus: existing.dayStatus,
    location,
  });
}
