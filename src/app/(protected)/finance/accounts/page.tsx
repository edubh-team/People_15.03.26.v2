"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BuildingLibraryIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { RoleBadge } from "@/components/RoleBadge";
import AddPersonModal from "@/components/finance/accounts/AddPersonModal";
import { canAccessFinance } from "@/lib/access";
import type {
  FinanceAccountDirectoryItem,
  FinanceAccountDirectoryResponse,
} from "@/lib/types/finance";

type AccountFilter = "ALL" | "EMPLOYEE" | "EXTERNAL";

type SensitiveFieldProps = {
  item: FinanceAccountDirectoryItem;
  field: "accountNumber" | "ifscCode";
  copiedId: string | null;
  privacyMode: boolean;
  onCopy: (value: string, key: string) => void;
  onToggleReveal: (key: string) => void;
  revealedFields: Record<string, boolean>;
};

function SensitiveField({
  item,
  field,
  copiedId,
  privacyMode,
  onCopy,
  onToggleReveal,
  revealedFields,
}: SensitiveFieldProps) {
  const rawValue = item[field];
  const maskedValue =
    field === "accountNumber" ? item.accountNumberMasked : item.ifscCodeMasked;
  const revealKey = `${field}:${item.id}`;
  const isVisible = !privacyMode || Boolean(revealedFields[revealKey]);

  if (!rawValue && !maskedValue) {
    return <span className="text-sm italic text-slate-400">Not set</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-sm text-slate-700">
        {isVisible ? rawValue : maskedValue}
      </span>
      <button
        type="button"
        onClick={() => onToggleReveal(revealKey)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
        title={isVisible ? "Hide sensitive value" : "Reveal sensitive value"}
      >
        {isVisible ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
      </button>
      {rawValue ? (
        <button
          type="button"
          onClick={() => onCopy(rawValue, revealKey)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-700"
          title="Copy full value"
        >
          {copiedId === revealKey ? (
            <CheckIcon className="h-4 w-4 text-emerald-500" />
          ) : (
            <ClipboardDocumentIcon className="h-4 w-4" />
          )}
        </button>
      ) : null}
    </div>
  );
}

export default function AccountsDirectoryPage() {
  const { firebaseUser } = useAuth();
  const [accounts, setAccounts] = useState<FinanceAccountDirectoryItem[]>([]);
  const [summary, setSummary] = useState<FinanceAccountDirectoryResponse["summary"]>({
    total: 0,
    employees: 0,
    external: 0,
    withSensitiveData: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(true);
  const [activeFilter, setActiveFilter] = useState<AccountFilter>("ALL");
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});

  const loadAccounts = useCallback(async () => {
    if (!firebaseUser) return;

    setLoading(true);
    setError(null);

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/finance/accounts", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const data = (await res.json()) as
        | FinanceAccountDirectoryResponse
        | { error?: string };

      if (!res.ok) {
        const message = "error" in data ? data.error : undefined;
        throw new Error(message || "Failed to load finance directory");
      }

      const payload = data as FinanceAccountDirectoryResponse;
      setAccounts(payload.items);
      setSummary(payload.summary);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load finance directory");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleCopy = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const toggleReveal = useCallback((key: string) => {
    setRevealedFields((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const filteredAccounts = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();

    return accounts.filter((account) => {
      if (activeFilter !== "ALL" && account.type !== activeFilter) return false;
      if (!term) return true;

      return [
        account.name,
        account.email,
        account.employeeId ?? "",
        account.phone,
        account.accountNumber ?? "",
        account.ifscCode ?? "",
        account.role,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [accounts, activeFilter, searchQuery]);

  const filterButtons: Array<{
    key: AccountFilter;
    label: string;
    count: number;
    icon: typeof UsersIcon;
    tone: string;
  }> = [
    {
      key: "ALL",
      label: "All Accounts",
      count: summary.total,
      icon: BuildingLibraryIcon,
      tone: "bg-slate-100 text-slate-700 border-slate-200",
    },
    {
      key: "EMPLOYEE",
      label: "Employees",
      count: summary.employees,
      icon: UsersIcon,
      tone: "bg-indigo-50 text-indigo-700 border-indigo-100",
    },
    {
      key: "EXTERNAL",
      label: "Beneficiaries",
      count: summary.external,
      icon: BuildingLibraryIcon,
      tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
    },
  ];

  return (
    <AuthGate allowIf={(user) => canAccessFinance(user)}>
      <div className="min-h-screen bg-slate-50/50 p-6 md:p-8">
        <div className="space-y-6">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Accounts Directory
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Payroll-ready employee accounts and beneficiary banking records.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-80 group">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <MagnifyingGlassIcon className="h-5 w-5 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
                </div>
                <input
                  type="text"
                  placeholder="Search by name, role, ID, email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm leading-5 shadow-sm transition-all placeholder:text-slate-400 hover:shadow-md focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setPrivacyMode((value) => !value);
                  setRevealedFields({});
                }}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                  privacyMode
                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <ShieldCheckIcon className="h-5 w-5" />
                {privacyMode ? "Privacy Mode On" : "Privacy Mode Off"}
              </button>

              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-700 active:scale-95"
              >
                <UserPlusIcon className="h-5 w-5" />
                <span>Add Person</span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {filterButtons.map((filter) => {
              const Icon = filter.icon;
              const active = activeFilter === filter.key;

              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveFilter(filter.key)}
                  className={`rounded-2xl border p-5 text-left transition-all ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/15"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${
                        active ? "border-white/10 bg-white/10" : filter.tone
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={`text-xs font-semibold ${active ? "text-white/70" : "text-slate-500"}`}>
                      {filter.label}
                    </span>
                  </div>
                  <div className="mt-5 text-3xl font-semibold tracking-tight">
                    {filter.count}
                  </div>
                </button>
              );
            })}

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
                  <ShieldCheckIcon className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold text-amber-700">
                  Sensitive Fields
                </span>
              </div>
              <div className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                {summary.withSensitiveData}
              </div>
              <p className="mt-2 text-sm text-amber-900/80">
                Bank details stay masked until explicitly revealed or copied.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-md">
            <div className="flex flex-col gap-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
              <div>
                Showing <span className="font-semibold text-slate-900">{filteredAccounts.length}</span>{" "}
                of <span className="font-semibold text-slate-900">{summary.total}</span> records
              </div>
              <div>
                {privacyMode
                  ? "Privacy mode is active. Sensitive values are masked by default."
                  : "Privacy mode is off. Sensitive values are currently visible."}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-black/5">
            {loading ? (
              <div className="p-6">
                <div className="animate-pulse space-y-4">
                  {[...Array(5)].map((_, index) => (
                    <div
                      key={index}
                      className="flex items-center space-x-4 border-b border-slate-50 p-4 last:border-0"
                    >
                      <div className="h-10 w-10 rounded-full bg-slate-100" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-1/4 rounded bg-slate-100" />
                        <div className="h-3 w-1/6 rounded bg-slate-100" />
                      </div>
                      <div className="h-8 w-1/6 rounded bg-slate-100" />
                      <div className="h-8 w-1/6 rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="p-8">
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5">
                  <div className="text-sm font-semibold text-rose-700">
                    Unable to load the finance directory
                  </div>
                  <p className="mt-1 text-sm text-rose-600">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadAccounts()}
                    className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-medium text-rose-700 shadow-sm ring-1 ring-rose-100 transition hover:bg-rose-50"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="flex flex-col items-center p-16 text-center text-slate-500">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
                  <MagnifyingGlassIcon className="h-8 w-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-medium text-slate-900">No accounts found</h3>
                <p className="mt-1 text-slate-400">Try adjusting your search or filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80 backdrop-blur-sm">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Account Holder
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Contact Info
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Bank Account
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        IFSC Code
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Role
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredAccounts.map((account) => (
                      <tr
                        key={account.id}
                        className="group transition-colors hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="flex items-center">
                            <div className="h-10 w-10 flex-shrink-0">
                              {account.photoURL ? (
                                <img
                                  className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                                  src={account.photoURL}
                                  alt=""
                                />
                              ) : (
                                <div
                                  className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold shadow-sm ring-2 ring-white ${
                                    account.type === "EXTERNAL"
                                      ? "bg-emerald-50 text-emerald-600"
                                      : "bg-indigo-50 text-indigo-500"
                                  }`}
                                >
                                  {(account.name || "?")
                                    .split(" ")
                                    .map((part) => part[0])
                                    .join("")
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-semibold text-slate-900">
                                {account.name}
                              </div>
                              {account.employeeId ? (
                                <div className="mt-0.5 flex items-center gap-1 font-mono text-xs text-slate-500">
                                  <span className="opacity-75">ID:</span>
                                  <span className="font-medium">{account.employeeId}</span>
                                </div>
                              ) : (
                                <div className="mt-0.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                                  EXTERNAL
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="text-sm font-medium text-slate-900">
                            {account.email || "No email"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {account.phone || "-"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <SensitiveField
                            item={account}
                            field="accountNumber"
                            copiedId={copiedId}
                            privacyMode={privacyMode}
                            onCopy={handleCopy}
                            onToggleReveal={toggleReveal}
                            revealedFields={revealedFields}
                          />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <SensitiveField
                            item={account}
                            field="ifscCode"
                            copiedId={copiedId}
                            privacyMode={privacyMode}
                            onCopy={handleCopy}
                            onToggleReveal={toggleReveal}
                            revealedFields={revealedFields}
                          />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          {account.type === "EMPLOYEE" ? (
                            <RoleBadge role={account.role} />
                          ) : (
                            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                              {account.role}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <AddPersonModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            void loadAccounts();
          }}
        />
      </div>
    </AuthGate>
  );
}
