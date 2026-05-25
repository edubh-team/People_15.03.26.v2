"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import type {
  PayrollDetailsResponse,
  PayrollListItem,
  SavePayrollRequest,
} from "@/lib/types/payroll";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  item: PayrollListItem | null;
  month: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

type FormState = {
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  halfDays: number;
  overtimeHours: number;
  workingDays: number;
  payableDays: number;
  fixedMonthlySalary: number;
  baseSalary: number;
  incentive: number;
  bonus: number;
  customAllowance: number;
  hra: number;
  studyAllowance: number;
  deduction: number;
  advanceDeduction: number;
  pf: number;
  tds: number;
  professionalTax: number;
  insurance: number;
  useNetPayOverride: boolean;
  netPayOverride: number;
  saveAsTemplate: boolean;
};

function toAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function buildForm(payload: PayrollDetailsResponse): FormState {
  const attendance = payload.payroll.attendanceSummary;
  const salary = payload.payroll.salaryBreakdown;
  const hasNetPayOverride = salary.netPayOverride != null;
  return {
    presentDays: toAmount(attendance.presentDays),
    absentDays: toAmount(attendance.absentDays),
    leaveDays: toAmount(attendance.leaveDays),
    halfDays: toAmount(attendance.halfDays),
    overtimeHours: toAmount(attendance.overtimeHours),
    workingDays: toAmount(attendance.workingDays),
    payableDays: toAmount(attendance.payableDays),
    fixedMonthlySalary: toAmount(salary.fixedMonthlySalary),
    baseSalary: toAmount(salary.baseSalary),
    incentive: toAmount(salary.incentive),
    bonus: toAmount(salary.bonus),
    customAllowance: toAmount(salary.customAllowance),
    hra: toAmount(salary.hra),
    studyAllowance: toAmount(salary.studyAllowance),
    deduction: toAmount(salary.deduction),
    advanceDeduction: toAmount(salary.advanceDeduction),
    pf: toAmount(salary.pf),
    tds: toAmount(salary.tds),
    professionalTax: toAmount(salary.professionalTax),
    insurance: toAmount(salary.insurance),
    useNetPayOverride: hasNetPayOverride,
    netPayOverride: toAmount(salary.netPayOverride ?? salary.netPay),
    saveAsTemplate: false,
  };
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className={`text-sm font-medium ${disabled ? "text-slate-400" : "text-slate-700"}`}>{label}</div>
      <div className="relative mt-2">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            {prefix}
          </span>
        ) : null}
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(toAmount(event.target.value))}
          className={`h-11 w-full rounded-xl border border-slate-200 pr-4 text-sm outline-none ring-indigo-500/15 transition focus:border-indigo-400 focus:ring-4 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-400 ${
            prefix ? "pl-12" : "pl-4"
          } ${disabled ? "bg-slate-50 text-slate-400" : "bg-white text-slate-900"}`}
        />
      </div>
    </label>
  );
}

export default function EditPayrollModal({
  isOpen,
  onClose,
  item,
  month,
  onSuccess,
  onError,
}: Props) {
  const { firebaseUser } = useAuth();
  const [details, setDetails] = useState<PayrollDetailsResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      if (!isOpen || !item || !firebaseUser) {
        if (active) {
          setDetails(null);
          setForm(null);
        }
        return;
      }

      try {
        setLoading(true);
        const token = await firebaseUser.getIdToken();
        const searchParams = new URLSearchParams();
        if (item.payroll?.id) {
          searchParams.set("payrollId", item.payroll.id);
        }
        const response = await fetch(
          `/api/payroll/${encodeURIComponent(item.employee.employeeId)}/${encodeURIComponent(month)}${
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
          throw new Error("error" in payload ? payload.error : "Unable to load payroll.");
        }

        if (!active) return;
        setDetails(payload as PayrollDetailsResponse);
        setForm(buildForm(payload as PayrollDetailsResponse));
      } catch (error: unknown) {
        if (!active) return;
        onError(error instanceof Error ? error.message : "Unable to load payroll.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDetails();
    return () => {
      active = false;
    };
  }, [firebaseUser, isOpen, item, month, onError]);

  const summary = useMemo(() => {
    if (!form) {
      return {
        gross: 0,
        lop: 0,
        totalDeductions: 0,
        computedNet: 0,
        net: 0,
      };
    }

    const perDay = form.baseSalary / Math.max(1, form.workingDays);
    const lop = Math.round(perDay * form.absentDays);
    const gross =
      form.baseSalary +
      form.incentive +
      form.bonus +
      form.customAllowance +
      form.hra +
      form.studyAllowance +
      Math.round((perDay / 8) * form.overtimeHours);
    const totalDeductions =
      lop +
      form.deduction +
      form.advanceDeduction +
      form.pf +
      form.tds +
      form.professionalTax +
      form.insurance;
    const computedNet = Math.max(0, gross - totalDeductions);
    const net = form.useNetPayOverride ? form.netPayOverride : computedNet;

    return { gross, lop, totalDeductions, computedNet, net };
  }, [form]);

  const validation = useMemo(() => {
    if (!form) {
      return { canSave: false, issues: ["Payroll form is not ready yet."] };
    }
    const issues: string[] = [];
    if (form.baseSalary <= 0) issues.push("Base salary must be greater than 0.");
    if (form.workingDays <= 0) issues.push("Working days must be greater than 0.");
    if (form.presentDays + form.leaveDays + form.halfDays > form.workingDays * 2) {
      issues.push("Attendance totals look unusually high. Please review working days.");
    }
    return { canSave: issues.length === 0, issues };
  }, [form]);

  async function submit(finalizeGeneration: boolean) {
    if (!firebaseUser || !item || !form) return;

    try {
      finalizeGeneration ? setFinalizing(true) : setSaving(true);
      const token = await firebaseUser.getIdToken();
      const payload: SavePayrollRequest = {
        employeeId: item.employee.employeeId,
        month,
        attendanceOverride: {
          presentDays: form.presentDays,
          absentDays: form.absentDays,
          leaveDays: form.leaveDays,
          halfDays: form.halfDays,
          overtimeHours: form.overtimeHours,
          workingDays: form.workingDays,
          payableDays: form.payableDays,
        },
        salaryOverride: {
          fixedMonthlySalary: form.fixedMonthlySalary,
          baseSalary: form.baseSalary,
          incentive: form.incentive,
          bonus: form.bonus,
          customAllowance: form.customAllowance,
          hra: form.hra,
          studyAllowance: form.studyAllowance,
          deduction: form.deduction,
          advanceDeduction: form.advanceDeduction,
          pf: form.pf,
          tds: form.tds,
          professionalTax: form.professionalTax,
          insurance: form.insurance,
          netPayOverride: form.useNetPayOverride ? form.netPayOverride : null,
        },
        saveAsTemplate: form.saveAsTemplate,
        finalizeGeneration,
      };

      const response = await fetch(
        `/api/payroll/${encodeURIComponent(item.employee.employeeId)}/${encodeURIComponent(month)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const result = (await response.json()) as PayrollDetailsResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in result ? result.error : "Unable to save payroll.");
      }

      onSuccess(
        finalizeGeneration
          ? "Payroll generated successfully."
          : "Payroll draft saved successfully.",
      );
      onClose();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Unable to save payroll.");
    } finally {
      setSaving(false);
      setFinalizing(false);
    }
  }

  const versionHistory = details?.versionHistory ?? [];
  const canGenerate = !details?.exists || details.payroll.status === "DRAFT";

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
              <Dialog.Panel className="w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-indigo-50 p-2.5 text-indigo-600">
                      <PencilSquareIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-slate-950">
                        Edit Payroll
                      </Dialog.Title>
                      <div className="mt-1 text-sm text-slate-500">
                        Save draft overrides before generation or revise a generated payslip with version history.
                      </div>
                      {item ? (
                        <div className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                          {item.employee.name} | {item.employee.employeeId} | {month}
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

                {loading || !form || !details ? (
                  <div className="p-10 text-center text-sm text-slate-500">Loading payroll editor...</div>
                ) : (
                  <>
                    <div className="grid gap-6 p-6 xl:grid-cols-[1.25fr_1.25fr_0.75fr]">
                      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Attendance Override
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <NumberField label="Present Days" value={form.presentDays} onChange={(value) => setForm((current) => current ? { ...current, presentDays: value } : current)} />
                          <NumberField label="Absent Days" value={form.absentDays} onChange={(value) => setForm((current) => current ? { ...current, absentDays: value } : current)} />
                          <NumberField label="Leave Days" value={form.leaveDays} onChange={(value) => setForm((current) => current ? { ...current, leaveDays: value } : current)} />
                          <NumberField label="Half Days" value={form.halfDays} onChange={(value) => setForm((current) => current ? { ...current, halfDays: value } : current)} />
                          <NumberField label="Overtime Hours" value={form.overtimeHours} onChange={(value) => setForm((current) => current ? { ...current, overtimeHours: value } : current)} />
                          <NumberField label="Working Days" value={form.workingDays} onChange={(value) => setForm((current) => current ? { ...current, workingDays: value } : current)} />
                          <NumberField label="Payable Days" value={form.payableDays} onChange={(value) => setForm((current) => current ? { ...current, payableDays: value } : current)} />
                        </div>
                      </section>

                      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Salary Override
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <NumberField label="Fixed Monthly Salary" prefix="INR" value={form.fixedMonthlySalary} onChange={(value) => setForm((current) => current ? { ...current, fixedMonthlySalary: value } : current)} />
                          <NumberField label="Base Salary" prefix="INR" value={form.baseSalary} onChange={(value) => setForm((current) => current ? { ...current, baseSalary: value } : current)} />
                          <NumberField label="Incentive" prefix="INR" value={form.incentive} onChange={(value) => setForm((current) => current ? { ...current, incentive: value } : current)} />
                          <NumberField label="Bonus" prefix="INR" value={form.bonus} onChange={(value) => setForm((current) => current ? { ...current, bonus: value } : current)} />
                          <NumberField label="Custom Allowance" prefix="INR" value={form.customAllowance} onChange={(value) => setForm((current) => current ? { ...current, customAllowance: value } : current)} />
                          <NumberField label="HRA" prefix="INR" value={form.hra} onChange={(value) => setForm((current) => current ? { ...current, hra: value } : current)} />
                          <NumberField label="Study Allowance" prefix="INR" value={form.studyAllowance} onChange={(value) => setForm((current) => current ? { ...current, studyAllowance: value } : current)} />
                          <NumberField label="Other Deduction" prefix="INR" value={form.deduction} onChange={(value) => setForm((current) => current ? { ...current, deduction: value } : current)} />
                          <NumberField label="Advance Deduction" prefix="INR" value={form.advanceDeduction} onChange={(value) => setForm((current) => current ? { ...current, advanceDeduction: value } : current)} />
                          <NumberField label="PF" prefix="INR" value={form.pf} onChange={(value) => setForm((current) => current ? { ...current, pf: value } : current)} />
                          <NumberField label="TDS" prefix="INR" value={form.tds} onChange={(value) => setForm((current) => current ? { ...current, tds: value } : current)} />
                          <NumberField label="Professional Tax" prefix="INR" value={form.professionalTax} onChange={(value) => setForm((current) => current ? { ...current, professionalTax: value } : current)} />
                          <NumberField label="Insurance" prefix="INR" value={form.insurance} onChange={(value) => setForm((current) => current ? { ...current, insurance: value } : current)} />
                          <label className="sm:col-span-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={form.useNetPayOverride}
                              onChange={(event) =>
                                setForm((current) =>
                                  current
                                    ? {
                                        ...current,
                                        useNetPayOverride: event.target.checked,
                                        netPayOverride: event.target.checked
                                          ? summary.computedNet
                                          : current.netPayOverride,
                                      }
                                    : current,
                                )
                              }
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                            />
                            Manually override final net pay for this month
                          </label>
                          <NumberField
                            label="Net Pay Override"
                            prefix="INR"
                            value={form.netPayOverride}
                            disabled={!form.useNetPayOverride}
                            onChange={(value) => setForm((current) => current ? { ...current, netPayOverride: value } : current)}
                          />
                        </div>

                        <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.saveAsTemplate}
                            onChange={(event) => setForm((current) => current ? { ...current, saveAsTemplate: event.target.checked } : current)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                          />
                          Apply these salary values to the recurring monthly salary template
                        </label>
                      </section>

                      <aside className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                          Summary
                        </div>
                        <div className="mt-4 space-y-4 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">Gross Salary</span>
                            <span className="font-semibold text-slate-950">
                              INR {Math.round(summary.gross).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">LOP</span>
                            <span className="font-semibold text-slate-950">
                              INR {Math.round(summary.lop).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">Total Deductions</span>
                            <span className="font-semibold text-slate-950">
                              INR {Math.round(summary.totalDeductions).toLocaleString()}
                            </span>
                          </div>
                          <div className="border-t border-emerald-200 pt-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                              {form.useNetPayOverride ? "Net Pay Override" : "Net Pay"}
                            </div>
                            <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-900">
                              INR {Math.round(summary.net).toLocaleString()}
                            </div>
                            <div className="mt-2 text-xs text-emerald-800/80">
                              {form.useNetPayOverride
                                ? `Computed net pay is INR ${Math.round(summary.computedNet).toLocaleString()}, but the manual override will be saved instead.`
                                : "Net pay is being auto-calculated from earnings and deductions."}
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                            <div className="font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Version History
                            </div>
                            <div className="mt-2 space-y-2">
                              {versionHistory.length === 0 ? (
                                <div>No prior versions yet.</div>
                              ) : (
                                versionHistory.slice(0, 5).map((version) => (
                                  <div key={version.id}>
                                    V{version.version} {version.changeType.toLowerCase()} by {version.changedBy?.name ?? "System"}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {validation.issues.length > 0 ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                              {validation.issues.map((issue) => (
                                <div key={issue}>{issue}</div>
                              ))}
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
                        disabled={saving || finalizing || !validation.canSave}
                        onClick={() => void submit(false)}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save Draft"}
                      </button>
                      {canGenerate ? (
                        <button
                          type="button"
                          disabled={saving || finalizing || !validation.canSave}
                          onClick={() => void submit(true)}
                          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {finalizing ? "Generating..." : "Save & Generate"}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
