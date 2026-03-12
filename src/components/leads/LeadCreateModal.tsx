"use client";

import { FormEvent, useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { createLeadAutoAssign } from "@/lib/firebase/leads";
import { canAssignSalesScope } from "@/lib/sales/hierarchy";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (leadId: string) => void;
};

type LeadCreateForm = {
  name: string;
  phone: string;
  email: string;
  currentEducation: string;
  targetDegree: string;
  targetUniversity: string;
  leadLocation: string;
  preferredLanguage: string;
  source: string;
  campaignName: string;
  leadTags: string;
  courseFees: string;
  note: string;
};

const DEFAULT_FORM: LeadCreateForm = {
  name: "",
  phone: "",
  email: "",
  currentEducation: "",
  targetDegree: "",
  targetUniversity: "",
  leadLocation: "",
  preferredLanguage: "",
  source: "Manual Entry",
  campaignName: "",
  leadTags: "",
  courseFees: "",
  note: "",
};

function parseTags(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function LeadCreateModal({ isOpen, onClose, onSuccess }: Props) {
  const { userDoc } = useAuth();
  const [form, setForm] = useState<LeadCreateForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAutoRoute = canAssignSalesScope(userDoc);
  const helperText = useMemo(
    () =>
      canAutoRoute
        ? "Lead will auto-route based on your team workload."
        : "Lead will be assigned to you and visible to your reporting manager chain.",
    [canAutoRoute],
  );

  if (!isOpen) return null;

  const setValue = (field: keyof LeadCreateForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const resetAndClose = () => {
    if (saving) return;
    setForm(DEFAULT_FORM);
    setError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userDoc?.uid) {
      setError("User session missing. Please re-login.");
      return;
    }

    const trimmedName = form.name.trim();
    const trimmedPhone = form.phone.trim();
    const trimmedEmail = form.email.trim();
    if (!trimmedName) {
      setError("Lead name is required.");
      return;
    }
    if (!trimmedPhone && !trimmedEmail) {
      setError("Add phone or email so the lead can be worked.");
      return;
    }

    const feeValue = form.courseFees.trim();
    const parsedFee = feeValue ? Number(feeValue.replace(/[^0-9.]/g, "")) : null;
    if (feeValue && (parsedFee == null || Number.isNaN(parsedFee))) {
      setError("Course fee must be a valid number.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const lead = await createLeadAutoAssign({
        managerId: userDoc.uid,
        fallbackAssigneeUid: canAutoRoute ? null : userDoc.uid,
        payload: {
          name: trimmedName,
          phone: trimmedPhone || null,
          email: trimmedEmail || null,
          currentEducation: form.currentEducation.trim() || null,
          targetDegree: form.targetDegree.trim() || null,
          targetUniversity: form.targetUniversity.trim() || null,
          leadLocation: form.leadLocation.trim() || null,
          preferredLanguage: form.preferredLanguage.trim() || null,
          source: form.source.trim() || "Manual Entry",
          campaignName: form.campaignName.trim() || null,
          leadTags: parseTags(form.leadTags),
          courseFees: parsedFee,
          note: form.note.trim() || null,
        },
      });
      setForm(DEFAULT_FORM);
      onSuccess?.(lead.leadId);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create lead.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add lead</h2>
            <p className="mt-1 text-xs text-slate-500">{helperText}</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close add lead modal"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Lead name *</span>
              <input
                value={form.name}
                onChange={(event) => setValue("name", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Student name"
                required
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Phone</span>
              <input
                value={form.phone}
                onChange={(event) => setValue("phone", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Mobile number"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Email</span>
              <input
                value={form.email}
                onChange={(event) => setValue("email", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="example@email.com"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Program</span>
              <input
                value={form.targetDegree}
                onChange={(event) => setValue("targetDegree", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="MBA / BBA / BCom..."
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">University</span>
              <input
                value={form.targetUniversity}
                onChange={(event) => setValue("targetUniversity", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Preferred university"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Current education</span>
              <input
                value={form.currentEducation}
                onChange={(event) => setValue("currentEducation", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Current education level"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Location</span>
              <input
                value={form.leadLocation}
                onChange={(event) => setValue("leadLocation", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="City / State"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Preferred language</span>
              <input
                value={form.preferredLanguage}
                onChange={(event) => setValue("preferredLanguage", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="English / Hindi / Telugu..."
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Source</span>
              <input
                value={form.source}
                onChange={(event) => setValue("source", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Manual Entry / Walk-in / Referral..."
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Campaign</span>
              <input
                value={form.campaignName}
                onChange={(event) => setValue("campaignName", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Campaign label"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Lead tags</span>
              <input
                value={form.leadTags}
                onChange={(event) => setValue("leadTags", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Comma-separated tags"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-medium">Estimated fee</span>
              <input
                value={form.courseFees}
                onChange={(event) => setValue("courseFees", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="0"
              />
            </label>
          </div>

          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">Note</span>
            <textarea
              value={form.note}
              onChange={(event) => setValue("note", event.target.value)}
              className="min-h-[92px] w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Context for the next action..."
            />
          </label>

          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving..." : "Create lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

