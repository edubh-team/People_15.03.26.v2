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
  where,
} from "firebase/firestore";
import { auth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/client";
import { calculateLeaveRangeBreakdown } from "@/lib/attendance/leave-policy";
import type {
  AttendanceDayDoc,
  GeoLocation,
  HolidayDoc,
  LeaveBalanceDoc,
  LeaveRequestDoc,
  PresenceDoc,
} from "@/lib/types/attendance";

export function getTodayKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysCollection(uid: string, yyyy: string, mm: string) {
  return collection(db!, "users", uid, "attendance", yyyy, "months", mm, "days");
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

async function postAttendanceAction<TPayload extends Record<string, unknown>>(
  action: string,
  payload?: TPayload,
) {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error("You must be signed in.");
  }

  const token = await currentUser.getIdToken();
  const response = await fetch("/api/attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action,
      ...(payload ?? {}),
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error || "Attendance request failed.");
  }

  return body;
}

export async function checkIn(uid: string) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("check_in");
}

export async function checkOut(uid: string) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("check_out");
}

export async function markOnLeave(uid: string) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("mark_on_leave");
}

export async function startBreak(uid: string) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("start_break");
}

export async function endBreak(uid: string) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("end_break");
}

export async function attachTodayLocation(uid: string, location: GeoLocation) {
  if (auth?.currentUser?.uid && auth.currentUser.uid !== uid) {
    throw new Error("Attendance request user mismatch.");
  }
  await postAttendanceAction("attach_location", { location });
}
