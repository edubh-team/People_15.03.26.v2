"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceDayDoc, PresenceDoc } from "@/lib/types/attendance";
import {
  attachTodayLocation,
  checkIn,
  checkOut,
  startBreak,
  endBreak,
  getAttendanceDaysForMonth,
  getAttendanceDaysForYear,
  getApprovedLeaveRequests,
  getMyLeaveRequests,
  getHolidaysForMonth,
  getLeaveBalance,
  getMyPresence,
  getRecentAttendanceDays,
  markOnLeave,
  applyForLeave,
} from "@/lib/firebase/attendance";
import type { GeoLocation } from "@/lib/types/attendance";

function presenceKey(uid: string) {
  return ["presence", uid] as const;
}

function attendanceDaysKey(uid: string) {
  return ["attendanceDays", uid] as const;
}

export function useMyPresence(uid: string | null | undefined) {
  return useQuery({
    queryKey: uid ? presenceKey(uid) : ["presence", "anonymous"],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return null;
      return getMyPresence(uid);
    },
  });
}

export function useMyAttendanceDays(uid: string | null | undefined, days = 14) {
  return useQuery({
    queryKey: uid ? [...attendanceDaysKey(uid), days] : ["attendanceDays", "anonymous", days],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return [];
      return getRecentAttendanceDays(uid, days);
    },
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string }) => {
      await checkIn(input.uid);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string }) => {
      await checkOut(input.uid);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useMarkOnLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string }) => {
      await markOnLeave(input.uid);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useStartBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string }) => {
      await startBreak(input.uid);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useEndBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string }) => {
      await endBreak(input.uid);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useAttachTodayLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uid: string; location: GeoLocation }) => {
      await attachTodayLocation(input.uid, input.location);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: presenceKey(input.uid) }),
        qc.invalidateQueries({ queryKey: attendanceDaysKey(input.uid) }),
      ]);
    },
  });
}

export function useAttendanceMonth(uid: string | null | undefined, year: number, monthIndex0: number) {
  return useQuery({
    queryKey: uid
      ? ["attendanceMonth", uid, year, monthIndex0]
      : ["attendanceMonth", "anonymous", year, monthIndex0],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return [];
      return getAttendanceDaysForMonth(uid, year, monthIndex0);
    },
  });
}

export function useAttendanceYear(uid: string | null | undefined, year: number) {
  return useQuery({
    queryKey: uid ? ["attendanceYear", uid, year] : ["attendanceYear", "anonymous", year],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return [];
      return getAttendanceDaysForYear(uid, year);
    },
  });
}

export function useHolidaysMonth(year: number, monthIndex0: number) {
  return useQuery({
    queryKey: ["holidaysMonth", year, monthIndex0],
    queryFn: async () => getHolidaysForMonth(year, monthIndex0),
  });
}

export function useApprovedLeaves(uid: string | null | undefined) {
  return useQuery({
    queryKey: uid ? ["approvedLeaveRequests", uid] : ["approvedLeaveRequests", "anonymous"],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return [];
      return getApprovedLeaveRequests(uid);
    },
  });
}

export function useMyLeaveRequests(uid: string | null | undefined) {
  return useQuery({
    queryKey: uid ? ["myLeaveRequests", uid] : ["myLeaveRequests", "anonymous"],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return [];
      return getMyLeaveRequests(uid);
    },
  });
}

export function useLeaveBalance(uid: string | null | undefined) {
  return useQuery({
    queryKey: uid ? ["leaveBalance", uid] : ["leaveBalance", "anonymous"],
    enabled: Boolean(uid),
    queryFn: async () => {
      if (!uid) return null;
      return getLeaveBalance(uid);
    },
  });
}

import type { LeaveRequestDoc } from "@/lib/types/attendance";

export function useApplyForLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
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
    }) => {
      await applyForLeave(input);
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["approvedLeaveRequests", input.uid] }),
        qc.invalidateQueries({ queryKey: ["myLeaveRequests", input.uid] }),
        qc.invalidateQueries({ queryKey: ["leaveBalance", input.uid] }),
      ]);
    },
  });
}

export type { AttendanceDayDoc, PresenceDoc };
