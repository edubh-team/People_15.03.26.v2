import { PresenceDoc, AttendanceDayDoc } from "@/lib/types/attendance";

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
  if (!record || !record.checkedInAt) return 0;
  
  const start = toDateSafe(record.checkedInAt);
  // If checked out, use check-out time. If not, use 'now'.
  // However, if we are looking at a past day, 'now' might be irrelevant if we don't have checkout.
  // But usually past days should be checked out or system auto-closes.
  // For 'today', if status is checked_in or on_break, we use 'now'.
  const end = record.checkedOutAt ? toDateSafe(record.checkedOutAt) : now;
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  
  let totalMs = Math.max(0, end.getTime() - start.getTime());
  
  if (record.breaks && Array.isArray(record.breaks)) {
    for (const b of record.breaks) {
      const bStart = toDateSafe(b.start);
      // If break has no end, it continues until 'now' (or the record end time)
      const bEnd = b.end ? toDateSafe(b.end) : end; 
      
      if (!isNaN(bStart.getTime()) && !isNaN(bEnd.getTime())) {
        const breakMs = Math.max(0, bEnd.getTime() - bStart.getTime());
        totalMs -= breakMs;
      }
    }
  }
  
  return Math.max(0, Math.floor(totalMs / 60000));
}
