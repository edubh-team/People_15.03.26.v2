import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  applyFinanceTransaction,
  deleteFinanceTransaction,
  normalizeFinanceTransactionInput,
} from "@/lib/server/finance-transactions";
import { getFinanceApprovalPolicy } from "@/lib/finance/controls";
import { buildServerActor, writeFinanceAuditEvent, writeServerAudit } from "@/lib/server/audit-log";
import { requireFinanceRequestUser } from "@/lib/server/request-auth";
import type {
  FinanceActorRef,
  FinanceApprovalListItem,
  FinanceApprovalListResponse,
  FinanceAuditEvent,
  FinanceTransactionDraft,
} from "@/lib/types/finance";

export const runtime = "nodejs";

function toIsoString(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: number }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function mapApprovalItem(
  id: string,
  data: Record<string, unknown>,
  currentUid: string,
): FinanceApprovalListItem {
  const requestedBy = (data.requestedBy ?? {
    uid: "unknown",
    name: "Unknown",
    role: "Unknown",
  }) as FinanceActorRef;

  return {
    id,
    action: (data.action as FinanceApprovalListItem["action"]) ?? "CREATE_TRANSACTION",
    status: (data.status as FinanceApprovalListItem["status"]) ?? "PENDING",
    summary: typeof data.summary === "string" ? data.summary : "Finance approval request",
    requestReason:
      typeof data.requestReason === "string" && data.requestReason.trim()
        ? data.requestReason
        : null,
    decisionReason:
      typeof data.decisionReason === "string" && data.decisionReason.trim()
        ? data.decisionReason
        : null,
    requestedBy,
    reviewedBy: (data.reviewedBy as FinanceActorRef | null) ?? null,
    transactionDraft: (data.transactionDraft as FinanceTransactionDraft | null) ?? null,
    existingTransactionId:
      typeof data.existingTransactionId === "string" ? data.existingTransactionId : null,
    existingTransactionSummary:
      typeof data.existingTransactionSummary === "string"
        ? data.existingTransactionSummary
        : null,
    appliedTransactionId:
      typeof data.appliedTransactionId === "string" ? data.appliedTransactionId : null,
    canReview: data.status === "PENDING" && requestedBy.uid !== currentUid,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    decidedAt: toIsoString(data.decidedAt),
  };
}

function mapAuditEvent(
  id: string,
  data: Record<string, unknown>,
): FinanceAuditEvent {
  return {
    id,
    eventType: typeof data.eventType === "string" ? data.eventType : "finance_event",
    action: typeof data.action === "string" ? data.action : "FINANCE_EVENT",
    summary: typeof data.summary === "string" ? data.summary : "Finance activity",
    actor: (data.actor ?? {
      uid: "system",
      name: "System",
      role: "SYSTEM",
    }) as FinanceActorRef,
    approvalRequestId:
      typeof data.approvalRequestId === "string" ? data.approvalRequestId : null,
    transactionId: typeof data.transactionId === "string" ? data.transactionId : null,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
    createdAt: toIsoString(data.createdAt),
  };
}

async function flushAuditWrites(writes: Array<Promise<unknown>>, context: string) {
  const settled = await Promise.allSettled(writes);

  settled.forEach((result) => {
    if (result.status === "rejected") {
      console.error(`${context} audit write failed:`, result.reason);
    }
  });
}

export async function GET(req: Request) {
  const verified = await requireFinanceRequestUser(req);
  if (!verified.ok) return verified.response;

  const { adminDb, uid } = verified.value;

  try {
    const [listSnap, pendingSnap, approvedSnap, rejectedSnap, eventsSnap] = await Promise.all([
      adminDb.collection("finance_approval_requests").orderBy("createdAt", "desc").limit(30).get(),
      adminDb.collection("finance_approval_requests").where("status", "==", "PENDING").get(),
      adminDb.collection("finance_approval_requests").where("status", "==", "APPROVED").get(),
      adminDb.collection("finance_approval_requests").where("status", "==", "REJECTED").get(),
      adminDb.collection("finance_audit_events").orderBy("createdAt", "desc").limit(20).get(),
    ]);

    const items = listSnap.docs.map((doc) => mapApprovalItem(doc.id, doc.data(), uid));
    const recentEvents = eventsSnap.docs.map((doc) => mapAuditEvent(doc.id, doc.data()));

    return NextResponse.json<FinanceApprovalListResponse>(
      {
        items,
        recentEvents,
        summary: {
          pending: pendingSnap.size,
          approved: approvedSnap.size,
          rejected: rejectedSnap.size,
        },
        policy: getFinanceApprovalPolicy(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    console.error("Finance approvals load failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load finance approvals" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const verified = await requireFinanceRequestUser(req);
  if (!verified.ok) return verified.response;

  const { adminDb, uid, userDoc } = verified.value;
  const actor = buildServerActor({
    uid,
    displayName: userDoc.displayName,
    email: userDoc.email,
    role: userDoc.role,
    orgRole: userDoc.orgRole,
  });

  try {
    const body = (await req.json()) as {
      id?: string;
      decision?: string;
      decisionReason?: string;
    };
    const approvalId = typeof body.id === "string" ? body.id.trim() : "";
    const decision = typeof body.decision === "string" ? body.decision.trim().toUpperCase() : "";
    const decisionReason =
      typeof body.decisionReason === "string" && body.decisionReason.trim()
        ? body.decisionReason.trim()
        : null;

    if (!approvalId || !decision) {
      return NextResponse.json(
        { error: "Approval id and decision are required" },
        { status: 400 },
      );
    }

    if (decision !== "APPROVE" && decision !== "REJECT") {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    if (decision === "REJECT" && !decisionReason) {
      return NextResponse.json(
        { error: "A rejection reason is required" },
        { status: 400 },
      );
    }

    const requestRef = adminDb.collection("finance_approval_requests").doc(approvalId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    const requestData = requestSnap.data() as Record<string, unknown>;
    const requestedBy = requestData.requestedBy as FinanceActorRef | undefined;

    if (!requestedBy) {
      return NextResponse.json(
        { error: "Approval request is missing requester details" },
        { status: 400 },
      );
    }

    if (requestedBy.uid === uid) {
      return NextResponse.json(
        { error: "Maker-checker requires a different reviewer." },
        { status: 409 },
      );
    }

    if (requestData.status !== "PENDING") {
      return NextResponse.json(
        { error: "Approval request has already been processed" },
        { status: 409 },
      );
    }

    const summary =
      typeof requestData.summary === "string"
        ? requestData.summary
        : "Finance approval request";

    if (decision === "REJECT") {
      await requestRef.set(
        {
          status: "REJECTED",
          reviewedBy: actor,
          decisionReason,
          decidedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await flushAuditWrites(
        [
          writeFinanceAuditEvent(adminDb, {
            eventType: "approval_rejected",
            action: "FINANCE_APPROVAL_REJECTED",
            summary,
            actor,
            approvalRequestId: approvalId,
            metadata: {
              decisionReason,
            },
          }),
          writeServerAudit(adminDb, {
            action: "FINANCE_APPROVAL_REJECTED",
            details: `${summary} rejected`,
            actor,
            metadata: {
              approvalRequestId: approvalId,
              decisionReason,
            },
          }),
        ],
        "finance approval reject",
      );

      return NextResponse.json({
        success: true,
        status: "rejected",
        id: approvalId,
      });
    }

    let appliedTransactionId =
      typeof requestData.appliedTransactionId === "string"
        ? requestData.appliedTransactionId
        : null;

    if (requestData.action === "CREATE_TRANSACTION") {
      if (!appliedTransactionId) {
        const existingApplied = await adminDb
          .collection("finance_transactions")
          .where("approvalRequestId", "==", approvalId)
          .limit(1)
          .get();

        if (!existingApplied.empty) {
          appliedTransactionId = existingApplied.docs[0]?.id ?? null;
        } else {
          const transactionDraft = requestData.transactionDraft;
          if (!transactionDraft || typeof transactionDraft !== "object") {
            return NextResponse.json(
              { error: "Approval request is missing transaction data" },
              { status: 400 },
            );
          }

          const normalizedDraft = normalizeFinanceTransactionInput(
            transactionDraft as Record<string, unknown>,
          );
          const applied = await applyFinanceTransaction(adminDb, normalizedDraft, requestedBy, {
            approvalRequestId: approvalId,
            approvedBy: actor,
          });

          appliedTransactionId = applied.transactionId;
        }
      }
    } else if (requestData.action === "DELETE_TRANSACTION") {
      const existingTransactionId =
        typeof requestData.existingTransactionId === "string"
          ? requestData.existingTransactionId
          : "";

      if (!existingTransactionId) {
        return NextResponse.json(
          { error: "Approval request is missing the transaction reference" },
          { status: 400 },
        );
      }

      const txSnap = await adminDb.collection("finance_transactions").doc(existingTransactionId).get();

      if (txSnap.exists) {
        const deleted = await deleteFinanceTransaction(adminDb, existingTransactionId);
        appliedTransactionId = deleted.deletedId;
      } else {
        appliedTransactionId = existingTransactionId;
      }
    } else {
      return NextResponse.json(
        { error: "Unsupported finance approval action" },
        { status: 400 },
      );
    }

    await requestRef.set(
      {
        status: "APPROVED",
        reviewedBy: actor,
        decisionReason,
        decidedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        appliedTransactionId,
      },
      { merge: true },
    );

    await flushAuditWrites(
      [
        writeFinanceAuditEvent(adminDb, {
          eventType: "approval_approved",
          action: "FINANCE_APPROVAL_APPROVED",
          summary,
          actor,
          approvalRequestId: approvalId,
          transactionId: appliedTransactionId,
          metadata: {
            decisionReason,
          },
        }),
        writeServerAudit(adminDb, {
          action: "FINANCE_APPROVAL_APPROVED",
          details: `${summary} approved`,
          actor,
          metadata: {
            approvalRequestId: approvalId,
            transactionId: appliedTransactionId,
            decisionReason,
          },
        }),
      ],
      "finance approval approve",
    );

    return NextResponse.json({
      success: true,
      status: "approved",
      id: approvalId,
      appliedTransactionId,
    });
  } catch (error: any) {
    console.error("Finance approval update failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update finance approval" },
      { status: 500 },
    );
  }
}
