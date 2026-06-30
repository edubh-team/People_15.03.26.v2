"use client";

import Link from "next/link";

export default function SuperAdminLeadsBridgePage() {
  return (
    <div className="space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          Legacy Route
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Super Admin Leads moved to consolidated CRM
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Use CRM workbench or inspector for all lead operations and audits.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/crm/leads?surface=inspector"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Open CRM Inspector
          </Link>
          <Link
            href="/crm/leads?surface=workbench"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open CRM Workbench
          </Link>
        </div>
      </div>
    </div>
  );
}
