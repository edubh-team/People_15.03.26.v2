"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDocs, 
  query, 
  setDoc, 
  where, 
  addDoc,
  serverTimestamp,
  updateDoc, 
  increment,
  orderBy
} from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import type { UserDoc } from "@/lib/types/user";
import { logAudit } from "@/lib/audit";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

// --- Types ---

type PayrollDoc = {
  uid: string;
  baseSalary: number;
  allowances: { hra: number; travel: number; bonus: number };
  taxRegime: "OLD_REGIME" | "NEW_REGIME";
  bankDetails: { accountNumber: string; ifsc: string };
};

type PayrollUser = UserDoc & { payroll?: PayrollDoc };

type HikeRequestDoc = {
  id: string;
  uid: string; // Employee
  requesterUid: string; // Manager
  currentSalary: number;
  requestedSalary: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: unknown;
  user?: UserDoc; // Hydrated
};

// --- Icons ---

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7-8v8m14-8v8M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

// --- Components ---

function SecurityGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const VAULT_PIN = process.env.NEXT_PUBLIC_PAYROLL_VAULT_PIN || "0000";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === VAULT_PIN) {
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center">
      <div className="mb-6 rounded-full bg-slate-100 p-4 ring-1 ring-slate-200">
        <LockIcon className="h-10 w-10 text-slate-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Payroll Vault Locked</h2>
      <p className="mt-2 text-sm text-slate-500">Enter security PIN to access financial data.</p>
      
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col items-center gap-4">
        <input 
          type="password" 
          maxLength={4}
          className={`h-12 w-40 rounded-xl border bg-white text-center text-2xl font-bold tracking-[1em] text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 ${
            error ? "border-red-300 ring-2 ring-red-100" : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-100"
          }`}
          placeholder="••••"
          value={pin}
          onChange={e => {
            setPin(e.target.value);
            if (error) setError(false);
          }}
          autoFocus
        />
        {error && (
          <div className="text-xs font-medium text-red-600">
            Incorrect PIN. Please try again.
          </div>
        )}
        <button 
          type="submit"
          className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Unlock Vault
        </button>
        <p className="text-xs text-slate-400 mt-4">PIN required</p>
      </form>
    </div>
  );
}

function SalaryTable({ users, onEdit }: { users: PayrollUser[]; onEdit: (u: PayrollUser) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-6 py-4 shadow-[1px_0_0_rgba(0,0,0,0.05)]">Employee</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4 text-right">Base Pay</th>
              <th className="px-6 py-4 text-right">HRA</th>
              <th className="px-6 py-4 text-right">Bonus</th>
              <th className="px-6 py-4 text-right">Net Est.</th>
              <th className="px-6 py-4">Tax Regime</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const p = u.payroll;
              const base = p?.baseSalary || 0;
              const hra = p?.allowances.hra || 0;
              const bonus = p?.allowances.bonus || 0;
              const total = base + hra + bonus;
              
              return (
                <tr key={u.uid} className="group hover:bg-slate-50/50">
                  <td className="sticky left-0 bg-white px-6 py-4 font-medium text-slate-900 shadow-[1px_0_0_rgba(0,0,0,0.05)] group-hover:bg-slate-50/50">
                    <div className="flex flex-col">
                      <span>{u.displayName || "Unknown"}</span>
                      <span className="text-[11px] font-normal text-slate-400">{u.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
                      {u.orgRole}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-mono">₹{base.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-mono text-slate-500">₹{hra.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-mono text-emerald-600">
                    {bonus > 0 ? `+₹${bonus.toLocaleString()}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">
                    ₹{total.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    {p?.taxRegime === "NEW_REGIME" ? "New Regime" : p?.taxRegime === "OLD_REGIME" ? "Old Regime" : "-"}
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => onEdit(u)}
                      className="text-indigo-600 hover:text-indigo-500 font-medium text-xs"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {users.length === 0 && (
        <div className="p-12 text-center text-sm text-slate-500">
          No active employees found in the system.
        </div>
      )}
    </div>
  );
}

function BonusDispatcher({ users }: { users: PayrollUser[] }) {
  const [selectedUid, setSelectedUid] = useState("");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedUid || amount <= 0) return;
    setSaving(true);
    try {
      // 1. Update Payroll Doc
      const payrollRef = doc(db, "payroll", selectedUid);
      await updateDoc(payrollRef, {
        "allowances.bonus": increment(amount)
      });

      // 2. Log to Ledger
      const ledgerRef = collection(db, "payroll", selectedUid, "ledger");
      await addDoc(ledgerRef, {
        type: "BONUS",
        amount,
        reason,
        dispatchedBy: "SUPER_ADMIN",
        createdAt: serverTimestamp()
      });

      // 3. Audit Log
      await logAudit("DISPATCH_BONUS", `Issued bonus of ₹${amount} to user ${selectedUid}`, "SUPER_ADMIN", { amount, reason, uid: selectedUid });

      alert("Bonus dispatched successfully!");
      setAmount(0);
      setReason("");
      setSelectedUid("");
    } catch (err: unknown) {
      alert("Error dispatching bonus: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <GiftIcon className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Performance Bonus Dispatcher</h3>
          <p className="text-sm text-slate-500">Issue one-time bonuses directly to employee payroll.</p>
        </div>
      </div>

      <form onSubmit={handleDispatch} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Beneficiary</label>
          <select 
            className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
            value={selectedUid}
            onChange={e => setSelectedUid(e.target.value)}
            required
          >
            <option value="">Select Employee...</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName} ({u.role})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Bonus Amount (₹)</label>
          <div className="relative">
            <span className="absolute left-4 top-2.5 text-slate-500">₹</span>
            <input 
              type="number" 
              className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 pl-8 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
              value={amount || ""}
              onChange={e => setAmount(Number(e.target.value))}
              placeholder="0.00"
              required
              min="1"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Reason / Note</label>
          <textarea 
            className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Q4 Performance Incentive"
            required
          />
        </div>

        <button 
          type="submit"
          disabled={saving || !selectedUid || amount <= 0}
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Processing Transaction..." : "Dispatch Bonus"}
        </button>
      </form>
    </div>
  );
}

function HikeRequestsApprover() {
  const [requests, setRequests] = useState<HikeRequestDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    // Mocking the query - in real app would query 'hike_requests' collection
    (async () => {
      try {
        const q = query(collection(db, "hike_requests"), where("status", "==", "PENDING"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as HikeRequestDoc));
        
        // Hydrate with user data
        const userIds = Array.from(new Set(data.map(r => r.uid)));
        if (userIds.length > 0) {
           // Batch fetch users if possible, or just individual
           const usersSnap = await getDocs(query(collection(db, "users"), where("uid", "in", userIds.slice(0, 10)))); // Limit 10 for 'in' query safety
           const userMap = new Map();
           usersSnap.docs.forEach(d => userMap.set(d.data().uid, d.data()));
           
           data.forEach(r => {
             r.user = userMap.get(r.uid);
           });
        }
        setRequests(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDecision = async (req: HikeRequestDoc, approved: boolean) => {
    if (!db) return;
    try {
      if (approved) {
        // Update Payroll
        await updateDoc(doc(db, "payroll", req.uid), {
          baseSalary: req.requestedSalary
        });
        await logAudit("UPDATE_PAYROLL", `Approved hike to ₹${req.requestedSalary} for ${req.uid}`, "SUPER_ADMIN");
      }
      
      // Update Request Status
      await updateDoc(doc(db, "hike_requests", req.id), {
        status: approved ? "APPROVED" : "REJECTED",
        processedAt: serverTimestamp(),
        processedBy: "SUPER_ADMIN"
      });

      setRequests(requests.filter(r => r.id !== req.id));
      alert(`Request ${approved ? "Approved" : "Rejected"}`);
    } catch (e: unknown) {
      alert("Error: " + (e instanceof Error ? e.message : "Unknown error"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Salary Hike Requests</h3>
          <p className="text-sm text-slate-500">Review and approve salary revisions proposed by managers.</p>
        </div>
        <div className="text-sm text-slate-500">
          {requests.length} Pending
        </div>
      </div>

      <div className="grid gap-4">
        {requests.map(req => (
          <div key={req.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
               <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 font-bold">
                  {req.user?.displayName?.[0] || "?"}
               </div>
               <div>
                 <div className="font-medium text-slate-900">{req.user?.displayName || "Unknown User"}</div>
                 <div className="text-xs text-slate-500">Current: ₹{req.currentSalary.toLocaleString()} → Requested: <span className="font-semibold text-slate-900">₹{req.requestedSalary.toLocaleString()}</span></div>
                 <div className="mt-1 text-xs text-slate-500 italic">&quot;{req.reason}&quot;</div>
               </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleDecision(req, false)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Reject
              </button>
              <button 
                onClick={() => handleDecision(req, true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Approve Hike
              </button>
            </div>
          </div>
        ))}
        {requests.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No pending hike requests found.
          </div>
        )}
      </div>
    </div>
  );
}

function PayrollEditor({ user, onClose, onSave }: { user: PayrollUser; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState<PayrollDoc>({
    uid: user.uid,
    baseSalary: user.payroll?.baseSalary || 0,
    allowances: user.payroll?.allowances || { hra: 0, travel: 0, bonus: 0 },
    taxRegime: user.payroll?.taxRegime || "NEW_REGIME",
    bankDetails: user.payroll?.bankDetails || { accountNumber: "", ifsc: "" },
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!db) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "payroll", user.uid), form, { merge: true });
      await logAudit("UPDATE_PAYROLL", `Updated payroll structure for ${user.displayName}`, "SUPER_ADMIN");
      onSave();
      onClose();
    } catch (e: unknown) {
      alert("Error saving payroll: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Edit Payroll Structure</h3>
            <p className="text-sm text-slate-500">For {user.displayName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100">
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Earnings</h4>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Base Salary</span>
              <input 
                type="number" 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono"
                value={form.baseSalary}
                onChange={e => setForm({ ...form, baseSalary: Number(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">HRA</span>
              <input 
                type="number" 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono"
                value={form.allowances.hra}
                onChange={e => setForm({ ...form, allowances: { ...form.allowances, hra: Number(e.target.value) } })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Travel Allowance</span>
              <input 
                type="number" 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono"
                value={form.allowances.travel}
                onChange={e => setForm({ ...form, allowances: { ...form.allowances, travel: Number(e.target.value) } })}
              />
            </label>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compliance & Banking</h4>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Tax Regime</span>
              <select 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                value={form.taxRegime}
                onChange={e => setForm({ ...form, taxRegime: e.target.value as "OLD_REGIME" | "NEW_REGIME" })}
              >
                <option value="NEW_REGIME">New Regime</option>
                <option value="OLD_REGIME">Old Regime</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Bank Account No.</span>
              <input 
                type="text" 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono"
                value={form.bankDetails.accountNumber}
                onChange={e => setForm({ ...form, bankDetails: { ...form.bankDetails, accountNumber: e.target.value } })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">IFSC Code</span>
              <input 
                type="text" 
                className="mt-1 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono"
                value={form.bankDetails.ifsc}
                onChange={e => setForm({ ...form, bankDetails: { ...form.bankDetails, ifsc: e.target.value } })}
              />
            </label>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---

export default function PayrollVaultPage() {
  const [locked, setLocked] = useState(true);
  const [activeTab, setActiveTab] = useState<"salary" | "bonus" | "requests">("salary");
  const [users, setUsers] = useState<PayrollUser[]>([]);
  const [editingUser, setEditingUser] = useState<PayrollUser | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch Data
  async function fetchData() {
    if (!db) return;
    setLoading(true);
    try {
      // 1. Get Active Users
      const usersQ = query(collection(db, "users"), where("status", "==", "active"));
      const usersSnap = await getDocs(usersQ);
      const userDocs = usersSnap.docs.map(d => d.data() as UserDoc);

      // 2. Get Payroll Docs (We fetch all for now, assuming small org. For large orgs, would need pagination/search)
      // Since we can't do a "where uid in [all uids]" efficiently if > 10, we'll just fetch all payroll docs
      // OR better, fetch individual payroll docs as needed? No, user wants a table.
      // We will try to fetch all payroll docs.
      const payrollSnap = await getDocs(collection(db, "payroll"));
      const payrollMap = new Map<string, PayrollDoc>();
      payrollSnap.docs.forEach(d => {
        payrollMap.set(d.id, d.data() as PayrollDoc);
      });

      // 3. Merge
      const merged = userDocs.map(u => ({
        ...u,
        payroll: payrollMap.get(u.uid)
      }));

      setUsers(merged);
    } catch (e) {
      console.error("Error fetching payroll data:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!locked) {
      fetchData();
    }
  }, [locked]);

  return (
    <AuthGate allowedOrgRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-slate-50/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Payroll Vault</h1>
            <p className="mt-1 text-sm text-slate-500">
              Confidential Salary & Compensation Management
            </p>
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {locked ? (
              <motion.div
                key="locked"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
              >
                <SecurityGate onUnlock={() => setLocked(false)} />
              </motion.div>
            ) : (
              <ErrorBoundary>
                <motion.div
                  key="unlocked"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {/* Tabs */}
                  <div className="mb-6 flex space-x-1 rounded-xl bg-slate-200/50 p-1 w-fit">
                    <button
                      onClick={() => setActiveTab("salary")}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                        activeTab === "salary" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/50"
                      }`}
                    >
                      <TableIcon className="h-4 w-4" />
                      Salary Registry
                    </button>
                    <button
                      onClick={() => setActiveTab("bonus")}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                        activeTab === "bonus" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/50"
                      }`}
                    >
                      <GiftIcon className="h-4 w-4" />
                      Bonus Dispatcher
                    </button>
                    <button
                      onClick={() => setActiveTab("requests")}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                        activeTab === "requests" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/50"
                      }`}
                    >
                      <TrendingUpIcon className="h-4 w-4" />
                      Hike Requests
                    </button>
                  </div>

                  {/* Views */}
                  {loading ? (
                    <div className="flex h-96 w-full items-center justify-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
                        <div className="text-sm font-medium text-slate-500">Decrypting Payroll Data...</div>
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-[400px]">
                      {activeTab === "salary" && (
                        <SalaryTable users={users} onEdit={setEditingUser} />
                      )}
                      {activeTab === "bonus" && (
                        <BonusDispatcher users={users} />
                      )}
                      {activeTab === "requests" && (
                        <HikeRequestsApprover />
                      )}
                    </div>
                  )}
                </motion.div>
              </ErrorBoundary>
            )}
          </AnimatePresence>
        </div>

        {/* Modals */}
        {editingUser && (
          <PayrollEditor 
            user={editingUser} 
            onClose={() => setEditingUser(null)} 
            onSave={fetchData}
          />
        )}
      </div>
    </AuthGate>
  );
}
