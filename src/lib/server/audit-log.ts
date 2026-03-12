import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getServerAppEnvironment } from "@/lib/env";
import type { FinanceActorRef } from "@/lib/types/finance";

type ServerAuditEntry = {
  action: string;
  details: string;
  actor: FinanceActorRef;
  metadata?: Record<string, unknown>;
};

type FinanceAuditEntry = {
  eventType: string;
  action: string;
  summary: string;
  actor: FinanceActorRef;
  approvalRequestId?: string | null;
  transactionId?: string | null;
  metadata?: Record<string, unknown>;
};

export function buildServerActor(input: {
  uid?: string | null;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  orgRole?: string | null;
}): FinanceActorRef {
  return {
    uid: input.uid ?? "system",
    name: input.displayName?.trim() || input.email?.trim() || "System",
    role: input.orgRole?.trim() || input.role?.trim() || "SYSTEM",
  };
}

export async function writeServerAudit(adminDb: Firestore, entry: ServerAuditEntry) {
  await adminDb.collection("audit_logs").add({
    action: entry.action,
    details: entry.details,
    performedBy: entry.actor.name,
    actorUid: entry.actor.uid,
    actorRole: entry.actor.role,
    metadata: entry.metadata ?? {},
    source: "server",
    environment: getServerAppEnvironment(),
    timestamp: FieldValue.serverTimestamp(),
  });
}

export async function writeFinanceAuditEvent(adminDb: Firestore, entry: FinanceAuditEntry) {
  await adminDb.collection("finance_audit_events").add({
    eventType: entry.eventType,
    action: entry.action,
    summary: entry.summary,
    actor: entry.actor,
    approvalRequestId: entry.approvalRequestId ?? null,
    transactionId: entry.transactionId ?? null,
    metadata: entry.metadata ?? {},
    environment: getServerAppEnvironment(),
    createdAt: FieldValue.serverTimestamp(),
  });
}
