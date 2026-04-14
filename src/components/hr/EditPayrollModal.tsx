"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { updatePayroll } from "@/app/actions/hr";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Payroll } from "@/lib/types/hr";
import type { PayrollDetailsResponse } from "@/lib/types/payroll";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  payroll: Payroll | null;
  onSuccess: () => void;
};

type FormState = {
  baseSalary: number;
  studyAllowance: number;
  bonus: number;
  hra: number;
  lop: number;
  professionalTax: number;
  pf: number;
  insurance: number;
};

function toAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function getInitialForm(payroll: Payroll | null): FormState {
  const earnings = payroll?.earnings && !Array.isArray(payroll.earnings) ? payroll.earnings : undefined;
  const deductions = payroll?.deductionBreakdown;

  return {
    baseSalary: toAmount(earnings?.basicSalary ?? payroll?.basicSalary ?? payroll?.baseSalary),
    studyAllowance: toAmount(earnings?.studyAllowance),
    bonus: toAmount(earnings?.bonus ?? payroll?.bonus ?? payroll?.bonuses ?? payroll?.incentives),
    hra: toAmount(earnings?.hra),
    lop: toAmount(deductions?.lop ?? payroll?.deductions),
    professionalTax: toAmount(deductions?.professionalTax),
    pf: toAmount(deductions?.pf),
    insurance: toAmount(deductions?.insurance),
  };
}

function getFormFromDefaults(payload: PayrollDetailsResponse["defaultComponents"]): FormState {
  return {
    baseSalary: toAmount(payload.earnings.basicSalary),
    studyAllowance: toAmount(payload.earnings.studyAllowance),
    bonus: toAmount(payload.earnings.bonus),
    hra: toAmount(payload.earnings.hra),
    lop: toAmount(payload.deductionBreakdown.lop),
    professionalTax: toAmount(payload.deductionBreakdown.professionalTax),
    pf: toAmount(payload.deductionBreakdown.pf),
    insurance: toAmount(payload.deductionBreakdown.insurance),
  };
}

function CurrencyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          INR
        </span>
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(toAmount(event.target.value))}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm text-slate-900 outline-none ring-indigo-500/15 transition focus:border-indigo-400 focus:ring-4"
        />
      </div>
    </label>
  );
}

export default function EditPayrollModal({ isOpen, onClose, payroll, onSuccess }: Props) {
  const { firebaseUser } = useAuth();
  const [form, setForm] = useState<FormState>(getInitialForm(null));
  const [saving, setSaving] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [defaultForm, setDefaultForm] = useState<FormState | null>(null);

  useEffect(() => {
    setForm(getInitialForm(payroll));
  }, [payroll]);

  useEffect(() => {
    let active = true;

    async function loadDefaults() {
      if (!isOpen || !payroll || !firebaseUser) {
        if (active) {
          setDefaultForm(null);
          setLoadingDefaults(false);
        }
        return;
      }

      try {
        setLoadingDefaults(true);
        const token = await firebaseUser.getIdToken();
        const employeeKey = payroll.employeeId || payroll.uid;
        const searchParams = new URLSearchParams();
        if (payroll.id) {
          searchParams.set("payrollId", payroll.id);
        }

        const response = await fetch(
          `/api/payroll/${encodeURIComponent(employeeKey)}/${encodeURIComponent(payroll.month)}${
            searchParams.size > 0 ? `?${searchParams.toString()}` : ""
          }`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as PayrollDetailsResponse | { error?: string };

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Unable to load employee defaults.");
        }

        if (active) {
          setDefaultForm(getFormFromDefaults((payload as PayrollDetailsResponse).defaultComponents));
        }
      } catch (error: unknown) {
        if (active) {
          console.warn(
            "Unable to load employee payroll defaults:",
            error instanceof Error ? error.message : "Unknown error",
          );
          setDefaultForm(null);
        }
      } finally {
        if (active) {
          setLoadingDefaults(false);
        }
      }
    }

    void loadDefaults();

    return () => {
      active = false;
    };
  }, [firebaseUser, isOpen, payroll]);

  const totalEarnings = useMemo(
    () => form.baseSalary + form.studyAllowance + form.bonus + form.hra,
    [form],
  );
  const totalDeductions = useMemo(
    () => form.lop + form.professionalTax + form.pf + form.insurance,
    [form],
  );
  const netPay = useMemo(
    () => Math.max(0, totalEarnings - totalDeductions),
    [totalDeductions, totalEarnings],
  );
  const validation = useMemo(() => {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    if (form.baseSalary <= 0) {
      blockingIssues.push("Basic salary must be greater than 0.");
    }

    if (totalDeductions > totalEarnings) {
      blockingIssues.push("Total deductions cannot be greater than total earnings.");
    }

    if (form.lop > form.baseSalary) {
      warnings.push("LOP is higher than the base salary. Please verify the payroll loss-of-pay amount.");
    }

    if (netPay === 0 && totalEarnings > 0) {
      warnings.push("Net pay is 0 after deductions. Please review the entered deduction values.");
    }

    if (form.professionalTax + form.pf + form.insurance > totalEarnings && totalEarnings > 0) {
      warnings.push("Statutory deductions are unusually high relative to total earnings.");
    }

    return {
      blockingIssues,
      warnings,
      canSave: blockingIssues.length === 0,
    };
  }, [form, netPay, totalDeductions, totalEarnings]);

  async function handleSave() {
    if (!payroll || !firebaseUser) return;
    if (!validation.canSave) return;

    try {
      setSaving(true);
      const token = await firebaseUser.getIdToken();
      const result = await updatePayroll(
        payroll.id,
        {
          baseSalary: form.baseSalary,
          studyAllowance: form.studyAllowance,
          bonus: form.bonus,
          hra: form.hra,
          lop: form.lop,
          professionalTax: form.professionalTax,
          pf: form.pf,
          insurance: form.insurance,
        },
        token,
        payroll.status === "PENDING_CREATION"
          ? {
              uid: payroll.uid,
              month: payroll.month,
            }
          : undefined,
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to update payroll.");
      }

      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update payroll.";
      window.alert(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 scale-[0.98]"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-4 scale-[0.98]"
            >
              <Dialog.Panel className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-indigo-50 p-2.5 text-indigo-600">
                      <PencilSquareIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-slate-950">
                        Edit Payroll Components
                      </Dialog.Title>
                      <div className="mt-1 text-sm text-slate-500">
                        Update the earnings and deductions that appear in the payslip.
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          disabled={loadingDefaults || !defaultForm}
                          onClick={() => {
                            if (defaultForm) {
                              setForm(defaultForm);
                            }
                          }}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loadingDefaults ? "Loading defaults..." : "Reset to Employee Defaults"}
                        </button>
                      </div>
                      {defaultForm ? (
                        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
                          <div className="font-semibold uppercase tracking-[0.14em] text-sky-700">
                            Employee Profile Defaults
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div>Basic Salary: INR {Math.round(defaultForm.baseSalary).toLocaleString()}</div>
                            <div>Study Allowance: INR {Math.round(defaultForm.studyAllowance).toLocaleString()}</div>
                            <div>Performance Bonus: INR {Math.round(defaultForm.bonus).toLocaleString()}</div>
                            <div>House Rent Allowance: INR {Math.round(defaultForm.hra).toLocaleString()}</div>
                            <div>Professional Tax: INR {Math.round(defaultForm.professionalTax).toLocaleString()}</div>
                            <div>PF: INR {Math.round(defaultForm.pf).toLocaleString()}</div>
                            <div>Health Insurance: INR {Math.round(defaultForm.insurance).toLocaleString()}</div>
                            <div>LOP on Reset: INR {Math.round(defaultForm.lop).toLocaleString()}</div>
                          </div>
                          <div className="mt-2 text-[11px] text-sky-700">
                            Reset restores values derived from the employee profile and clears manual overrides in this payroll form.
                          </div>
                        </div>
                      ) : null}
                      {payroll ? (
                        <div className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                          {payroll.userDisplayName || payroll.employeeId || payroll.uid} • {payroll.month}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1fr_280px]">
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Earnings
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      These values appear directly in the payslip earnings table.
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Reset uses the current employee profile defaults for salary, allowance, and recurring bonus values.
                    </div>
                    <div className="mt-4 space-y-4">
                      <CurrencyInput
                        label="Basic Salary"
                        value={form.baseSalary}
                        onChange={(value) => setForm((current) => ({ ...current, baseSalary: value }))}
                      />
                      <CurrencyInput
                        label="Study Allowance"
                        value={form.studyAllowance}
                        onChange={(value) => setForm((current) => ({ ...current, studyAllowance: value }))}
                      />
                      <CurrencyInput
                        label="Performance Bonus"
                        value={form.bonus}
                        onChange={(value) => setForm((current) => ({ ...current, bonus: value }))}
                      />
                      <CurrencyInput
                        label="House Rent Allowance"
                        value={form.hra}
                        onChange={(value) => setForm((current) => ({ ...current, hra: value }))}
                      />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Deductions
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Keep the total deductions lower than or equal to total earnings.
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Reset uses the employee profile defaults for statutory deductions and clears LOP to 0.
                    </div>
                    <div className="mt-4 space-y-4">
                      <CurrencyInput
                        label="LOP (Loss of Pay)"
                        value={form.lop}
                        onChange={(value) => setForm((current) => ({ ...current, lop: value }))}
                      />
                      <CurrencyInput
                        label="Professional Tax"
                        value={form.professionalTax}
                        onChange={(value) => setForm((current) => ({ ...current, professionalTax: value }))}
                      />
                      <CurrencyInput
                        label="PF"
                        value={form.pf}
                        onChange={(value) => setForm((current) => ({ ...current, pf: value }))}
                      />
                      <CurrencyInput
                        label="Health Insurance"
                        value={form.insurance}
                        onChange={(value) => setForm((current) => ({ ...current, insurance: value }))}
                      />
                    </div>
                  </section>

                  <aside className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Summary
                    </div>
                    <div className="mt-5 space-y-4 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-600">Total Earnings</span>
                        <span className="font-semibold text-slate-950">
                          INR {Math.round(totalEarnings).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-600">Total Deductions</span>
                        <span className="font-semibold text-slate-950">
                          INR {Math.round(totalDeductions).toLocaleString()}
                        </span>
                      </div>
                      <div className="border-t border-emerald-200 pt-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                          Net Pay
                        </div>
                        <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-900">
                          INR {Math.round(netPay).toLocaleString()}
                        </div>
                        <div className="mt-2 text-xs text-emerald-800">
                          (Earnings - Deductions) = ({Math.round(totalEarnings).toLocaleString()} - {Math.round(totalDeductions).toLocaleString()})
                        </div>
                      </div>

                      {validation.blockingIssues.length > 0 ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                          <div className="font-semibold uppercase tracking-[0.14em]">Fix Before Saving</div>
                          <div className="mt-2 space-y-1">
                            {validation.blockingIssues.map((issue) => (
                              <div key={issue}>{issue}</div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {validation.warnings.length > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                          <div className="font-semibold uppercase tracking-[0.14em]">Review Warnings</div>
                          <div className="mt-2 space-y-1">
                            {validation.warnings.map((warning) => (
                              <div key={warning}>{warning}</div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </aside>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving || !validation.canSave}
                    onClick={() => void handleSave()}
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving ? "Saving..." : "Save Payroll"}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
