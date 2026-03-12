"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import type {
  FinanceApprovalListItem,
  FinanceApprovalListResponse,
  FinanceAuditEvent,
} from "@/lib/types/finance";

type Props = {
  refreshKey?: number;
  onAction?: (message: string, tone?: "success" | "info" | "error") => void;
};

type DecisionState = {
  approvalId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function getStatusClasses(status: FinanceApprovalListItem["status"]) {
  switch (status) {
    case "APPROVED":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "REJECTED":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-amber-50 text-amber-700 ring-amber-200";
  }
}

function getEventIcon(event: FinanceAuditEvent["action"]) {
  if (event.includes("REJECTED")) return XCircleIcon;
  if (event.includes("APPROVED") || event.includes("CREATED")) return CheckCircleIcon;
  return ClockIcon;
}

export default function FinanceApprovalsPanel({ refreshKey = 0, onAction }: Props) {
  const { firebaseUser } = useAuth();
  const [data, setData] = useState<FinanceApprovalListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [decisionState, setDecisionState] = useState<DecisionState | null>(null);

  async function loadApprovals() {
    if (!firebaseUser) return;

    try {
      setLoading(true);
      setError(null);
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/finance/approvals", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as
        | FinanceApprovalListResponse
        | { error?: string };

      if (!response.ok) {
        const message = "error" in payload ? payload.error : undefined;
        throw new Error(message || "Failed to load finance approvals");
      }

      setData(payload as FinanceApprovalListResponse);
    } catch (loadError: any) {
      console.error(loadError);
      setError(loadError.message || "Failed to load finance approvals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadApprovals();
  }, [firebaseUser, refreshKey]);

  const pendingItems = useMemo(
    () => data?.items.filter((item) => item.status === "PENDING") ?? [],
    [data],
  );

  async function handleDecision() {
    if (!firebaseUser || !decisionState) return;

    if (decisionState.decision === "REJECT" && !decisionState.reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }

    try {
      setProcessingId(decisionState.approvalId);
      setError(null);
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/finance/approvals", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: decisionState.approvalId,
          decision: decisionState.decision,
          decisionReason: decisionState.reason.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update approval request");
      }

      onAction?.(
        decisionState.decision === "APPROVE"
          ? "Finance request approved."
          : "Finance request rejected.",
        decisionState.decision === "APPROVE" ? "success" : "info",
      );
      setDecisionState(null);
      await loadApprovals();
    } catch (decisionError: any) {
      console.error(decisionError);
      setError(decisionError.message || "Failed to update approval request");
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
              <ShieldCheckIcon className="h-4 w-4" />
              Finance Controls
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Approvals and audit trail</h3>
              <p className="text-sm text-slate-500">
                {data?.policy.enabled
                  ? "Sensitive finance actions now route through maker-checker review."
                  : "Maker-checker is currently inactive. Transactions apply immediately until the finance approval flags are enabled."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadApprovals()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {data?.policy.enabled ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Minimum Amount</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {currencyFormatter.format(data.policy.minimumAmount)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Debit Review</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {data.policy.requireAllDebits ? "All debits require review" : "Threshold and category based"}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Sensitive Categories</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {data.policy.sensitiveCategories.join(", ") || "None configured"}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending</div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">{data?.summary.pending ?? 0}</div>
          <div className="mt-1 text-sm text-slate-500">Awaiting maker-checker review.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Approved</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-700">{data?.summary.approved ?? 0}</div>
          <div className="mt-1 text-sm text-slate-500">Requests already applied to the ledger.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rejected</div>
          <div className="mt-2 text-3xl font-semibold text-rose-700">{data?.summary.rejected ?? 0}</div>
          <div className="mt-1 text-sm text-slate-500">Requests stopped before touching balances.</div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Approval queue</h3>
              <p className="text-sm text-slate-500">Pending items stay at the top of operational review.</p>
            </div>
            <div className="text-xs text-slate-400">{pendingItems.length} pending in view</div>
          </div>

          <div className="mt-5 space-y-4">
            {loading ? (
              <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
            ) : data?.items.length ? (
              data.items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${getStatusClasses(item.status)}`}>
                          {item.status}
                        </span>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {item.action === "CREATE_TRANSACTION" ? "Create" : "Delete"}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.summary}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Requested by {item.requestedBy.name} ({item.requestedBy.role}) on {formatDate(item.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>Updated {formatDate(item.updatedAt)}</div>
                      {item.decidedAt ? <div>Decision {formatDate(item.decidedAt)}</div> : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Request Note</div>
                      <div className="mt-1 text-sm text-slate-700">{item.requestReason || "No additional justification recorded."}</div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Decision Note</div>
                      <div className="mt-1 text-sm text-slate-700">{item.decisionReason || "Pending review."}</div>
                    </div>
                  </div>

                  {item.transactionDraft ? (
                    <div className="mt-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Amount</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {currencyFormatter.format(item.transactionDraft.amount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Category</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{item.transactionDraft.category}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Date</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {item.transactionDraft.dateInput || "Server timestamp"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : item.existingTransactionSummary ? (
                    <div className="mt-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Target Transaction</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{item.existingTransactionSummary}</div>
                    </div>
                  ) : null}

                  {item.reviewedBy ? (
                    <div className="mt-3 text-xs text-slate-500">
                      Reviewed by {item.reviewedBy.name} ({item.reviewedBy.role})
                    </div>
                  ) : null}

                  {item.canReview ? (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      {decisionState?.approvalId === item.id ? (
                        <div className="space-y-3">
                          <textarea
                            rows={3}
                            value={decisionState.reason}
                            onChange={(event) =>
                              setDecisionState((current) =>
                                current
                                  ? {
                                      ...current,
                                      reason: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            placeholder={
                              decisionState.decision === "APPROVE"
                                ? "Optional approval note"
                                : "Reason for rejection"
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleDecision()}
                              disabled={processingId === item.id}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {processingId === item.id
                                ? "Saving..."
                                : decisionState.decision === "APPROVE"
                                  ? "Confirm Approval"
                                  : "Confirm Rejection"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDecisionState(null)}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDecisionState({
                                approvalId: item.id,
                                decision: "APPROVE",
                                reason: "",
                              })
                            }
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDecisionState({
                                approvalId: item.id,
                                decision: "REJECT",
                                reason: "",
                              })
                            }
                            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm hover:bg-rose-100"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No finance approval requests yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Immutable finance events</h3>
          <p className="mt-1 text-sm text-slate-500">Recent server-side finance activity.</p>
          <div className="mt-5 space-y-3">
            {(data?.recentEvents ?? []).length ? (
              data?.recentEvents.map((event) => {
                const Icon = getEventIcon(event.action);
                return (
                  <div key={event.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mt-0.5 rounded-full bg-white p-2 ring-1 ring-slate-200">
                      <Icon className="h-4 w-4 text-slate-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{event.summary}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {event.actor.name} ({event.actor.role})
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{formatDate(event.createdAt)}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No finance audit events yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
