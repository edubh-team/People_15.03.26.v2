import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase/client";

export type AuditActionType = 
  | "LOGIN" 
  | "LOGOUT"
  | "CREATE_USER" 
  | "TERMINATE_USER" 
  | "PROMOTE_USER" 
  | "UPDATE_PAYROLL" 
  | "DISPATCH_BONUS"
  | "APPROVE_LEAVE"
  | "REJECT_LEAVE"
  | "ASSIGN_LEAD"
  | "REOPEN_LEAD"
  | "LEAD_STATUS_CHANGE"
  | "SYSTEM_CHANGE";

export async function logAudit(
  action: AuditActionType, 
  details: string, 
  performedBy: string = "SUPER_ADMIN",
  metadata: Record<string, unknown> = {}
) {
  if (!db) return;
  try {
    await addDoc(collection(db, "audit_logs"), {
      action,
      details,
      performedBy,
      timestamp: serverTimestamp(),
      metadata
    });
  } catch (error) {
    console.error("Failed to log audit event:", error);
  }
}
