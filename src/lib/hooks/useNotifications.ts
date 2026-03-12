"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db, isFirebaseReady } from "@/lib/firebase/client";

export type NotificationDoc = {
  id: string;
  recipientUid: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: unknown;
  relatedTaskId?: string;
  priority?: "high" | "medium" | "low";
};

export function useMyUnreadNotifications(uid: string | null | undefined) {
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);

  const isActive = Boolean(db && uid && isFirebaseReady);
  const ref = useMemo(() => {
    if (!db || !uid || !isFirebaseReady) return null;
    return query(
      collection(db, "notifications"),
      where("recipientUid", "==", uid),
      where("read", "==", false),
      limit(50),
    );
  }, [uid]);

  useEffect(() => {
    if (!ref) return;
    return onSnapshot(
      ref,
      (snap) => {
        setCount(snap.size);
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as NotificationDoc));
        // Sort by createdAt descending (client-side sort since Firestore compound queries can be tricky without index)
        docs.sort((a, b) => {
             const getT = (t: unknown) => (t && typeof (t as Timestamp).toDate === 'function') ? (t as Timestamp).toDate().getTime() : 0;
             return getT(b.createdAt) - getT(a.createdAt);
        });
        setNotifications(docs);
      },
      (error) => {
        if ((error as { code?: string })?.code === "permission-denied") {
          setCount(0);
          setNotifications([]);
          return;
        }
        console.error("Notifications listener error", error);
        setCount(0);
        setNotifications([]);
      },
    );
  }, [ref]);

  return { count: isActive ? count : 0, notifications: isActive ? notifications : [] };
}
