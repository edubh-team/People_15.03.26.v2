export type PresenceStatus = "checked_in" | "checked_out" | "on_leave" | "on_break" | "absent";

export type BreakSession = {
  start: unknown;
  end?: unknown | null;
};

export type GeoLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp?: number;
};

export type AttendanceDayStatus = "present" | "late" | "on_leave" | "absent";

export type PresenceDoc = {
  uid: string;
  dateKey: string;
  status: PresenceStatus;
  checkedInAt: unknown | null;
  checkedOutAt: unknown | null;
  dayStatus?: AttendanceDayStatus;
  location?: GeoLocation | null;
  breaks?: BreakSession[];
  autoCheckout?: boolean;
  updatedAt: unknown;
};

export type AttendanceDayDoc = {
  uid: string;
  dateKey: string;
  status: PresenceStatus;
  checkedInAt: unknown | null;
  checkedOutAt: unknown | null;
  dayStatus?: AttendanceDayStatus;
  location?: GeoLocation | null;
  breaks?: BreakSession[];
  autoCheckout?: boolean;
  createdAt: unknown;
  updatedAt: unknown;
};

export type HolidayDoc = {
  dateKey: string;
  name: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export type LeaveRequestStatus =
  | "pending"
  | "pending_hr"
  | "pending_manager"
  | "approved"
  | "rejected";
export type LeaveType = "pto" | "unpaid" | "casual" | "medical";

export type LeaveRequestDoc = {
  uid: string;
  startDateKey: string;
  endDateKey: string;
  type: LeaveType;
  status: LeaveRequestStatus;
  requesterRole?: string | null;
  reportingManagerId?: string | null;
  includeSaturdayAsLeave?: boolean;
  weekendPolicy?: {
    saturday: "optional_off";
    sunday: "mandatory_off";
    includeSaturdayAsLeave: boolean;
  };
  chargeableDays?: number;
  totalCalendarDays?: number;
  saturdayExcludedDays?: number;
  sundayExcludedDays?: number;
  hrDecision?: "pending" | "approved" | "rejected";
  hrReviewedAt?: unknown;
  hrReviewedBy?: string | null;
  managerDecision?: "pending" | "approved" | "rejected";
  managerReviewedAt?: unknown;
  managerReviewedBy?: string | null;
  forwardedToManagerAt?: unknown;
  reason?: string;
  attachmentUrl?: string;
  assignedHR?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type LeaveBalanceDoc = {
  uid: string;
  ptoRemaining: number;
  lastResetMonth?: string; // YYYY-MM
  updatedAt: unknown;
};
