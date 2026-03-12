"use client";

import { useState, useEffect, useMemo, Fragment } from "react";
import { FinanceTransaction, FinanceTransactionMutationResponse } from "@/lib/types/finance";
import { format } from "date-fns";
import { DocumentTextIcon, XMarkIcon, BanknotesIcon, CalendarDaysIcon, CreditCardIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { Dialog, Transition } from "@headlessui/react";
import { useAuth } from "@/components/auth/AuthProvider";
import { db } from "@/lib/firebase/client";
import { doc, updateDoc } from "firebase/firestore";

interface Props {
  transactions: FinanceTransaction[];
  currentBalance: number;
  onAction?: (message: string, tone?: "success" | "info" | "error") => void;
}

function toDate(timestamp: any): Date {
  if (!timestamp) return new Date();
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  return new Date(timestamp);
}

export default function LedgerTable({ transactions, currentBalance, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "CREDIT" | "DEBIT">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const transactionsWithBalance = useMemo(() => {
    let runningBal = currentBalance;
    return transactions.map((tx) => {
      const balanceForThisRow = runningBal;
      if (tx.type === "CREDIT") {
        runningBal -= tx.amount;
      } else {
        runningBal += tx.amount;
      }
      return { ...tx, computedBalance: balanceForThisRow };
    });
  }, [currentBalance, transactions]);

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          transactionsWithBalance
            .map((tx) => (tx.category || "").trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [transactionsWithBalance],
  );

  const filteredTransactions = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return transactionsWithBalance.filter((tx) => {
      if (typeFilter !== "ALL" && tx.type !== typeFilter) return false;
      if (categoryFilter !== "ALL" && tx.category !== categoryFilter) return false;
      if (!term) return true;
      const toUserLabel = Array.isArray(tx.toUser)
        ? tx.toUser.map((entry) => `${entry.name} ${entry.otherDetails ?? ""}`).join(" ")
        : tx.toUser
          ? `${tx.toUser.name} ${tx.toUser.otherDetails ?? ""}`
          : "";
      return [
        tx.category,
        tx.remarks,
        tx.paymentMode,
        tx.performedBy?.name,
        tx.performedBy?.role,
        toUserLabel,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [categoryFilter, searchQuery, transactionsWithBalance, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedTransactions = filteredTransactions.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, pageSize, searchQuery, typeFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px_120px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search category, notes, actor, beneficiary..."
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "ALL" | "CREDIT" | "DEBIT")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          >
            <option value="ALL">All types</option>
            <option value="CREDIT">Credits only</option>
            <option value="DEBIT">Debits only</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          >
            <option value="ALL">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select
            value={String(pageSize)}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          >
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Showing {pagedTransactions.length} of {filteredTransactions.length} matching transactions.
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
          <div className="text-slate-400 text-sm">No transactions found</div>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
          <div className="text-slate-400 text-sm">No matching transactions for current filters.</div>
        </div>
      ) : null}

      {filteredTransactions.length > 0 ? (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Particulars</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Mode</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Proof</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Debit (Out)</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit (In)</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {pagedTransactions.map((tx) => {
              const date = toDate(tx.transactionDate);
              const isCredit = tx.type === "CREDIT";
              
              return (
                <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                    {format(date, "MMM d, yyyy")}
                  </td>
                  <td
                    className="px-6 py-4 cursor-pointer"
                    onClick={() => {
                      setSelected(tx);
                      setOpen(true);
                    }}
                    title="View transaction details"
                    role="button"
                  >
                    <div className="text-sm font-medium text-slate-900">{tx.category}</div>
                    <div className="text-xs text-slate-500 truncate max-w-[200px]">{tx.remarks}</div>
                    <div className="text-[10px] text-slate-400 mt-1">By: {tx.performedBy.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                    {tx.paymentMode || "—"}
                    {tx.chequeNo && (
                      <div className="text-[10px] text-slate-400">No: {tx.chequeNo}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {tx.proofUrl ? (
                      <a 
                        href={tx.proofUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        <DocumentTextIcon className="h-4 w-4" />
                        View
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-rose-600">
                    {!isCredit ? `₹${tx.amount.toLocaleString()}` : ""}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-emerald-600">
                    {isCredit ? `₹${tx.amount.toLocaleString()}` : ""}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-slate-700">
                    ₹{tx.computedBalance.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      ) : null}

      {filteredTransactions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
      <DetailsModal
        open={open}
        onClose={() => {
          setOpen(false);
          setSelected(null);
        }}
        tx={selected}
        onDeleted={() => {
          setOpen(false);
          setSelected(null);
        }}
        onAction={onAction}
      />
    </>
  );
}

function DetailsModal({
  open,
  onClose,
  tx,
  onDeleted,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  tx: FinanceTransaction | null;
  onDeleted: () => void;
  onAction?: (message: string, tone?: "success" | "info" | "error") => void;
}) {
  const { firebaseUser } = useAuth();
  const date = tx ? toDate(tx.transactionDate) : new Date();
  const isCredit = tx?.type === "CREDIT";
  const directionLabel = isCredit ? "From" : "To";
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editRemarks, setEditRemarks] = useState(tx?.remarks || "");

  useEffect(() => {
    setEditRemarks(tx?.remarks || "");
    setEditing(false);
    setDeleteError(null);
  }, [tx, open]);

  async function handleDelete() {
    if (!tx || !firebaseUser) return;
    if (deleting) return;
    const confirmed = window.confirm("Are you sure you want to delete this transaction? This cannot be undone.");
    if (!confirmed) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/finance/transaction", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ id: tx.id }),
      });
      if (!res.ok) {
        let message = "Failed to delete transaction. Please try again.";
        try {
          const data = await res.json();
          if (data?.error) {
            message = data.error;
          }
        } catch {
          // ignore parse error
        }
        setDeleteError(message);
      } else {
        const data = (await res.json()) as FinanceTransactionMutationResponse | { error?: string };
        const isPendingApproval = "status" in data && data.status === "pending_approval";
        onAction?.(
          "message" in data && data.message
            ? data.message
            : isPendingApproval
              ? "Delete request submitted for approval."
              : "Transaction deleted successfully.",
          isPendingApproval ? "info" : "success",
        );
        onDeleted();
      }
    } catch (err) {
      console.error("Failed to delete transaction", err);
      setDeleteError("Failed to delete transaction. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (!tx || !firebaseUser || !db) return;
    try {
      await updateDoc(doc(db, "finance_transactions", tx.id), {
        remarks: editRemarks.trim(),
      });
      onAction?.("Transaction details updated.", "success");
      setEditing(false);
    } catch (err) {
      console.error("Failed to update transaction", err);
      setDeleteError("Failed to update transaction details. Please try again.");
    }
  }
 
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </Transition.Child>
 
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-xl transform overflow-hidden rounded-3xl bg-white text-left align-middle shadow-2xl transition-all ring-1 ring-slate-200">
                <div className="relative">
                  <div className="h-1.5 w-full bg-gradient-to-r from-slate-100 via-indigo-100 to-slate-100" />
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                        {tx?.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                        isCredit ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-rose-50 text-rose-700 ring-rose-600/20"
                      }`}>
                        <BanknotesIcon className="h-4 w-4" />
                        {tx?.type}
                      </span>
                      <button
                        aria-label="Close"
                        onClick={onClose}
                        className="rounded-md p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
 
                <div className="px-6 py-6 space-y-6">
                  <div className="flex items-end justify-between">
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">Amount</div>
                      <div className={`text-2xl font-semibold tracking-tight ${isCredit ? "text-emerald-700" : "text-rose-700"}`}>
                        ₹{tx?.amount.toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <CalendarDaysIcon className="h-5 w-5" />
                      <span className="text-sm font-medium">{format(date, "MMM d, yyyy")}</span>
                    </div>
                  </div>
 
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <CreditCardIcon className="h-5 w-5" />
                        <span className="text-xs font-medium">Payment Mode</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {tx?.paymentMode || "—"}{tx?.chequeNo ? <span className="text-slate-500 ml-1">(No: {tx.chequeNo})</span> : null}
                      </div>
                    </div>
                    {tx?.category === "Loan" && (tx?.loanBankName || tx?.loanInterestRate != null) ? (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                        <div className="flex items-center gap-2 text-slate-600">
                          <CreditCardIcon className="h-5 w-5" />
                          <span className="text-xs font-medium">Loan Details</span>
                        </div>
                        <div className="mt-1 text-sm text-slate-900">
                          <div><span className="text-slate-500">Bank:</span> <span className="font-medium">{tx.loanBankName || "—"}</span></div>
                          <div><span className="text-slate-500">Interest:</span> <span className="font-medium">{tx.loanInterestRate != null ? `${tx.loanInterestRate}%` : "—"}</span></div>
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <UserGroupIcon className="h-5 w-5" />
                        <span className="text-xs font-medium">{directionLabel}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-900">
                        {!tx?.toUser ? (
                          <span className="font-medium">N/A</span>
                        ) : Array.isArray(tx.toUser) ? (
                          <ul className="max-h-28 overflow-auto divide-y divide-slate-100 rounded-md bg-white/60 ring-1 ring-slate-200/60">
                            {tx.toUser.map((p) => (
                              <li key={p.id} className="px-3 py-2">
                                <span className="font-medium">{p.name}</span>
                                {p.type === "OTHER" && p.otherDetails ? (
                                  <span className="text-slate-500"> ({p.otherDetails})</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="font-medium">
                            {tx.toUser.name}
                            {tx.toUser.type === "OTHER" && tx.toUser.otherDetails ? (
                              <span className="text-slate-500"> ({tx.toUser.otherDetails})</span>
                            ) : null}
                          </span>
                        )}
                      </div>
                    </div>
                    {(tx?.category === "Salaries" || tx?.category === "EMI" || tx?.category === "Marketing" || tx?.category === "MARKETING") && tx?.salaryMonth ? (
                      <div className="rounded-xl border border-slate-100 bg-indigo-50/40 p-4 sm:col-span-2">
                        <div className="flex items-center gap-2 text-indigo-700">
                          <CalendarDaysIcon className="h-5 w-5" />
                          <span className="text-xs font-medium">
                            {tx?.category === "Salaries" ? "Salary Month" : "For Month"}
                          </span>
                        </div>
                        <div className="mt-1 inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                          {tx.salaryMonth}
                        </div>
                      </div>
                    ) : null}
                  </div>
 
                  <div className="rounded-xl border border-slate-100 p-4 bg-white/60">
                    <div className="text-xs font-medium text-slate-600 mb-1">Details</div>
                    {editing ? (
                      <textarea
                        rows={2}
                        value={editRemarks}
                        onChange={(e) => setEditRemarks(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm text-slate-800"
                        placeholder="Enter details..."
                      />
                    ) : (
                      <div className="text-sm text-slate-800 whitespace-pre-wrap min-h-5">
                        {tx?.remarks || "—"}
                      </div>
                    )}
                  </div>
 
                  <div className="flex items-center justify-between pt-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-slate-500">
                        By <span className="text-slate-700 font-medium">{tx?.performedBy.name}</span>
                      </div>
                      {deleteError && (
                        <div className="text-[11px] text-rose-600">{deleteError}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(false);
                              setEditRemarks(tx?.remarks || "");
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={!tx}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Save Changes
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditing(true)}
                            disabled={!tx}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Edit Details
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleting || !tx}
                            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {deleting ? "Deleting..." : "Delete Transaction"}
                          </button>
                        </>
                      )}
                      {tx?.proofUrl ? (
                        <a
                          href={tx.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 active:scale-95"
                        >
                          <DocumentTextIcon className="h-4 w-4" />
                          View Proof
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">No Proof</span>
                      )}
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
