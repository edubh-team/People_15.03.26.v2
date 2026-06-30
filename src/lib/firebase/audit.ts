import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type AuditEvent = 
  | "view_employee_details"
  | "view_lead_details"
  | "export_report";

export async function logAuditEvent(uid: string, event: AuditEvent, details: Record<string, unknown>) {
  if (!db) return;
  try {
    await addDoc(collection(db, "auditLogs"), {
      performedBy: uid,
      event,
      details,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log audit event", error);
  }
}
