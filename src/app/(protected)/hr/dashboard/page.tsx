"use client";

import Link from "next/link";
import { AuthGate } from "@/components/auth/AuthGate";
import { isHrUser } from "@/lib/access";

export default function HrDashboardLegacyBridgePage() {
  return (
    <AuthGate allowIf={(user) => isHrUser(user)}>
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Legacy Route
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            HR Dashboard moved to People Ops
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use the consolidated HR workspace for attendance, leaves, recruitment, and payroll access.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/hr"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open People Ops
            </Link>
            <Link
              href="/payroll"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Payroll Ops
            </Link>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}

