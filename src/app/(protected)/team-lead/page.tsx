"use client";

import Link from "next/link";
import { AuthGate } from "@/components/auth/AuthGate";
import { canManageTeam } from "@/lib/access";

export default function TeamLeadLegacyBridgePage() {
  return (
    <AuthGate allowIf={canManageTeam}>
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Legacy Route
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Team Lead dashboard moved to Team Workspace
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use the consolidated Team workspace for assignment, queue handling, and team execution.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/team"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Team Workspace
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

