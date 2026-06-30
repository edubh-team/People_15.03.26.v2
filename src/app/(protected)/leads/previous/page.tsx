"use client";

import Link from "next/link";
import { AuthGate } from "@/components/auth/AuthGate";

export default function LegacyWorkedLeadsBridgePage() {
  return (
    <AuthGate allowedRoles={["employee", "teamLead", "manager"]}>
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Legacy Route
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Worked Leads moved to consolidated CRM
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            The old list is now a bridge page. Continue all lead updates from the CRM worked
            queue.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/crm/leads?surface=worked&layout=compact"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Worked Leads Queue
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
    </AuthGate>
  );
}
