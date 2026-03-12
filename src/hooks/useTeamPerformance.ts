import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import type { UserDoc } from "@/lib/types/user";

export interface ReportDoc {
  id: string;
  userId: string;
  date: string;
  status: string;
  content?: string;
  createdAt: Timestamp;
  managerId?: string;
  teamLeadId?: string;
}

function chunk<T>(values: T[], size = 10) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getTimestampValue(value: unknown) {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export const useTeamPerformance = (user: UserDoc | null, dateFilter?: string) => {
  const [reportData, setReportData] = useState<ReportDoc[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const { users, loading: usersLoading } = useScopedUsers(user, {
    includeCurrentUser: true,
    includeInactive: false,
  });

  const scopedUserIds = useMemo(
    () => Array.from(new Set(users.map((member) => member.uid).filter(Boolean))).sort(),
    [users],
  );
  const scopeKey = useMemo(() => scopedUserIds.join("|"), [scopedUserIds]);

  useEffect(() => {
    if (!user || !db) {
      setReportData([]);
      setReportsLoading(false);
      return;
    }

    if (usersLoading) {
      setReportsLoading(true);
      return;
    }

    if (scopedUserIds.length === 0) {
      setReportData([]);
      setReportsLoading(false);
      return;
    }

    const firestore = db;
    const buckets = new Map<string, ReportDoc[]>();
    setReportsLoading(true);

    const syncReports = () => {
      const merged = new Map<string, ReportDoc>();
      buckets.forEach((rows) => {
        rows.forEach((report) => merged.set(report.id, report));
      });

      const orderedReports = Array.from(merged.values()).sort(
        (left, right) =>
          getTimestampValue(right.createdAt) - getTimestampValue(left.createdAt),
      );

      setReportData(orderedReports);
      setReportsLoading(false);
    };

    const unsubscribers = chunk(scopedUserIds).map((uidChunk, index) => {
      const constraints = [where("userId", "in", uidChunk)];
      if (dateFilter) {
        constraints.push(where("date", "==", dateFilter));
      }

      return onSnapshot(
        query(collection(firestore, "reports"), ...constraints),
        (reportSnapshot) => {
          buckets.set(
            `reports-${index}`,
            reportSnapshot.docs.map(
              (doc) => ({ id: doc.id, ...doc.data() }) as ReportDoc,
            ),
          );
          syncReports();
        },
        (error) => {
          setReportsLoading(false);
          console.error("Failed to load team performance reports:", error);
        },
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [dateFilter, scopeKey, scopedUserIds, user, usersLoading]);

  return {
    reportData,
    users,
    loading: usersLoading || reportsLoading,
  };
};
