import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFinanceApprovalPolicy, shouldRequireFinanceApproval } from "@/lib/finance/controls";
import {
  applyFinanceTransaction,
  buildFinanceTransactionSummary,
  deleteFinanceTransaction,
  normalizeFinanceTransactionInput,
} from "@/lib/server/finance-transactions";
import { buildServerActor, writeFinanceAuditEvent, writeServerAudit } from "@/lib/server/audit-log";
import { requireFinanceRequestUser } from "@/lib/server/request-auth";
import type { FinanceTransactionMutationResponse } from "@/lib/types/finance";

export const runtime = "nodejs";

async function flushFinanceAuditWrites(
  writes: Array<Promise<unknown>>,
  context: string,
) {
  const settled = await Promise.allSettled(writes);

  settled.forEach((result) => {
    if (result.status === "rejected") {
      console.error(`${context} audit write failed:`, result.reason);
    }
  });
}

export async function POST(req: Request) {
  try {
    const verified = await requireFinanceRequestUser(req);
    if (!verified.ok) return verified.response;

    const { adminDb, userDoc, uid } = verified.value;
    const body = (await req.json()) as Record<string, unknown>;
    const draft = normalizeFinanceTransactionInput(body);
    const policy = getFinanceApprovalPolicy();
    const actor = buildServerActor({
      uid,
      displayName: userDoc.displayName,
      email: userDoc.email,
      role: userDoc.role,
      orgRole: userDoc.orgRole,
    });
    const requestReason =
      typeof body.approvalReason === "string" && body.approvalReason.trim()
        ? body.approvalReason.trim()
        : null;
    const summary = buildFinanceTransactionSummary(draft);

    if (shouldRequireFinanceApproval(draft)) {
      const approvalRef = adminDb.collection("finance_approval_requests").doc();

      await approvalRef.set({
        action: "CREATE_TRANSACTION",
        status: "PENDING",
        summary,
        requestReason,
        decisionReason: null,
        requestedBy: actor,
        reviewedBy: null,
        transactionDraft: draft,
        existingTransactionId: null,
        existingTransactionSummary: null,
        appliedTransactionId: null,
        policySnapshot: policy,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        decidedAt: null,
      });

      await flushFinanceAuditWrites(
        [
          writeFinanceAuditEvent(adminDb, {
            eventType: "approval_requested",
            action: "FINANCE_APPROVAL_REQUESTED",
            summary,
            actor,
            approvalRequestId: approvalRef.id,
            metadata: {
              mode: "create",
              requestReason,
              transactionType: draft.type,
              amount: draft.amount,
              category: draft.category,
            },
          }),
          writeServerAudit(adminDb, {
            action: "FINANCE_APPROVAL_REQUESTED",
            details: `${summary} submitted for approval`,
            actor,
            metadata: {
              approvalRequestId: approvalRef.id,
              mode: "create",
              requestReason,
              transactionType: draft.type,
              amount: draft.amount,
              category: draft.category,
            },
          }),
        ],
        "finance transaction request",
      );

      return NextResponse.json<FinanceTransactionMutationResponse>({
        success: true,
        status: "pending_approval",
        approvalRequestId: approvalRef.id,
        message: "Transaction submitted for approval.",
      });
    }

    const applied = await applyFinanceTransaction(adminDb, draft, actor);

    await flushFinanceAuditWrites(
      [
        writeFinanceAuditEvent(adminDb, {
          eventType: "transaction_created",
          action: "FINANCE_TRANSACTION_CREATED",
          summary,
          actor,
          transactionId: applied.transactionId,
          metadata: {
            mode: "direct",
            amount: draft.amount,
            category: draft.category,
            type: draft.type,
          },
        }),
        writeServerAudit(adminDb, {
          action: "FINANCE_TRANSACTION_CREATED",
          details: `${summary} applied directly`,
          actor,
          metadata: {
            transactionId: applied.transactionId,
            runningBalanceAfter: applied.runningBalanceAfter,
            mode: "direct",
          },
        }),
      ],
      "finance transaction create",
    );

    return NextResponse.json<FinanceTransactionMutationResponse>({
      success: true,
      status: "applied",
      id: applied.transactionId,
      message: "Transaction recorded successfully.",
    });
  } catch (error: any) {
    console.error("Finance Transaction Error:", error);
    return NextResponse.json(
      { error: error.message || "Transaction failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const verified = await requireFinanceRequestUser(req);
    if (!verified.ok) return verified.response;

    const { adminDb, userDoc, uid } = verified.value;
    const body = (await req.json()) as { id?: string; approvalReason?: string };
    const transactionId = typeof body.id === "string" ? body.id.trim() : "";

    if (!transactionId) {
      return NextResponse.json(
        { error: "Transaction id is required" },
        { status: 400 },
      );
    }

    const txRef = adminDb.collection("finance_transactions").doc(transactionId);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const actor = buildServerActor({
      uid,
      displayName: userDoc.displayName,
      email: userDoc.email,
      role: userDoc.role,
      orgRole: userDoc.orgRole,
    });
    const policy = getFinanceApprovalPolicy();
    const existingTransaction = txSnap.data() as Record<string, unknown>;
    const summary = buildFinanceTransactionSummary({
      type: existingTransaction.type as "CREDIT" | "DEBIT",
      amount: Number(existingTransaction.amount) || 0,
      category: existingTransaction.category as any,
    });
    const requestReason =
      typeof body.approvalReason === "string" && body.approvalReason.trim()
        ? body.approvalReason.trim()
        : null;

    if (policy.deleteRequiresApproval) {
      const duplicateSnap = await adminDb
        .collection("finance_approval_requests")
        .where("existingTransactionId", "==", transactionId)
        .limit(5)
        .get();

      const pendingDeleteRequest = duplicateSnap.docs.find((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return data.action === "DELETE_TRANSACTION" && data.status === "PENDING";
      });

      if (pendingDeleteRequest) {
        return NextResponse.json(
          { error: "A delete approval request is already pending for this transaction." },
          { status: 409 },
        );
      }

      const approvalRef = adminDb.collection("finance_approval_requests").doc();

      await approvalRef.set({
        action: "DELETE_TRANSACTION",
        status: "PENDING",
        summary,
        requestReason,
        decisionReason: null,
        requestedBy: actor,
        reviewedBy: null,
        transactionDraft: null,
        existingTransactionId: transactionId,
        existingTransactionSummary: summary,
        appliedTransactionId: null,
        policySnapshot: policy,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        decidedAt: null,
      });

      await flushFinanceAuditWrites(
        [
          writeFinanceAuditEvent(adminDb, {
            eventType: "approval_requested",
            action: "FINANCE_APPROVAL_REQUESTED",
            summary,
            actor,
            approvalRequestId: approvalRef.id,
            transactionId,
            metadata: {
              mode: "delete",
              requestReason,
            },
          }),
          writeServerAudit(adminDb, {
            action: "FINANCE_APPROVAL_REQUESTED",
            details: `${summary} deletion submitted for approval`,
            actor,
            metadata: {
              approvalRequestId: approvalRef.id,
              transactionId,
              mode: "delete",
              requestReason,
            },
          }),
        ],
        "finance delete request",
      );

      return NextResponse.json<FinanceTransactionMutationResponse>({
        success: true,
        status: "pending_approval",
        approvalRequestId: approvalRef.id,
        message: "Delete request submitted for approval.",
      });
    }

    const deleted = await deleteFinanceTransaction(adminDb, transactionId);

    await flushFinanceAuditWrites(
      [
        writeFinanceAuditEvent(adminDb, {
          eventType: "transaction_deleted",
          action: "FINANCE_TRANSACTION_DELETED",
          summary,
          actor,
          transactionId,
          metadata: {
            mode: "direct",
            runningBalanceAfter: deleted.runningBalanceAfter,
          },
        }),
        writeServerAudit(adminDb, {
          action: "FINANCE_TRANSACTION_DELETED",
          details: `${summary} deleted directly`,
          actor,
          metadata: {
            transactionId,
            mode: "direct",
            runningBalanceAfter: deleted.runningBalanceAfter,
          },
        }),
      ],
      "finance delete",
    );

    return NextResponse.json<FinanceTransactionMutationResponse>({
      success: true,
      status: "applied",
      id: deleted.deletedId,
      message: "Transaction deleted successfully.",
    });
  } catch (error: any) {
    console.error("Finance Transaction Delete Error:", error);
    return NextResponse.json(
      { error: error.message || "Delete failed" },
      { status: 500 },
    );
  }
}
