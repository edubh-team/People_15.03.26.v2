import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserAccountStatus, UserRole } from "@/lib/types/user";

export type EmployeeAccessDoc = {
  email: string;
  role: UserRole;
  status: UserAccountStatus;
  teamLeadId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export async function getEmployeeAccessByEmail(email: string) {
  if (!db) throw new Error("Firebase is not configured");
  const normalized = email.trim().toLowerCase();
  const q = query(
    collection(db, "employees"),
    where("email", "==", normalized),
    limit(1),
  );
  const snap = await getDocs(q);
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return { ...(docSnap.data() as EmployeeAccessDoc) };
}

