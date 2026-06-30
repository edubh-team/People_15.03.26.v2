"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, limit, onSnapshot, query, where } from "firebase/firestore";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasRole } from "@/lib/access";
import {
  calculateChannelPartnerCommission,
  DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG,
  isLeadClosedWithinMonth,
  normalizeChannelPartnerCommissionConfig,
  type ChannelPartnerCommissionConfig,
} from "@/lib/channel-partner/commission";
import { db } from "@/lib/firebase/client";
import { isClosedLeadStatus } from "@/lib/leads/status";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import type { LeadDoc } from "@/lib/types/crm";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ChannelPartnerDashboardPage() {
  const { userDoc } = useAuth();
  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [config, setConfig] = useState<ChannelPartnerCommissionConfig>(
    DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG,
  );

  const canAccess = useMemo(
    () =>
      hasRole(
        userDoc,
        "CHANNEL_PARTNER",
        "MANAGER",
        "SENIOR_MANAGER",
        "GM",
        "AVP",
        "VP",
        "SALES_HEAD",
        "CBO",
        "CEO",
        "ADMIN",
        "SUPER_ADMIN",
      ),
    [userDoc],
  );

  useEffect(() => {
    const firestore = db;
    const ownerUid = userDoc?.uid;
    if (!firestore || !ownerUid || !canAccess) {
      setLeads([]);
      setLoadingLeads(false);
      return;
    }

    setLoadingLeads(true);
    const stop = onSnapshot(
      query(collection(firestore, "leads"), where("ownerUid", "==", ownerUid), limit(1500)),
      (snapshot) => {
        setLeads(
          snapshot.docs.map((row) => ({
            ...(row.data() as LeadDoc),
            leadId: row.id,
          })),
        );
        setLoadingLeads(false);
      },
      () => {
        setLeads([]);
        setLoadingLeads(false);
      },
    );

    return () => stop();
  }, [canAccess, userDoc?.uid]);

  useEffect(() => {
    const firestore = db;
    if (!firestore) return;

    const stop = onSnapshot(
      doc(firestore, "settings", "channel_partner_commission"),
      (snapshot) => {
        const raw = snapshot.exists()
          ? (snapshot.data() as Partial<ChannelPartnerCommissionConfig>)
          : null;
        setConfig(normalizeChannelPartnerCommissionConfig(raw));
      },
      () => setConfig(DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG),
    );

    return () => stop();
  }, []);

  const thisMonthClosedSales = useMemo(
    () => leads.filter((lead) => isLeadClosedWithinMonth(lead)).length,
    [leads],
  );
  const totalClosedSales = useMemo(
    () => leads.filter((lead) => isClosedLeadStatus(lead.status)).length,
    [leads],
  );
  const payout = useMemo(
    () =>
      calculateChannelPartnerCommission({
        saleCount: thisMonthClosedSales,
        config,
      }),
    [config, thisMonthClosedSales],
  );

  return (
    <AuthGate allowIf={() => canAccess}>
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Channel Partner
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sales and Commission Dashboard</h1>
              <p className="mt-2 text-sm text-slate-600">
                Track your monthly conversions and estimated commission in one place.
              </p>
            </div>
            <Link
              href={CANONICAL_DOMAIN_ROUTES.CRM}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Open CRM Leads
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total leads</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{leads.length}</div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">This month sales</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{thisMonthClosedSales}</div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total closed sales</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{totalClosedSales}</div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. commission</div>
            <div className="mt-2 text-2xl font-semibold text-indigo-700">{formatCurrency(payout.totalAmount)}</div>
            {!payout.eligible ? (
              <div className="mt-1 text-[11px] text-amber-700">
                Payout starts from {config.minimumSalesForPayout} sale(s) in month.
              </div>
            ) : null}
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">Commission Parameters</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span>Base per sale</span>
                <span className="font-semibold">{formatCurrency(config.basePerSale)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Bonus threshold</span>
                <span className="font-semibold">{config.bonusThresholdSales} sales</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Bonus per sale after threshold</span>
                <span className="font-semibold">{formatCurrency(config.bonusPerSaleAfterThreshold)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Minimum sales for payout</span>
                <span className="font-semibold">{config.minimumSalesForPayout}</span>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">This Month Breakdown</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span>Eligible sales</span>
                <span className="font-semibold">{payout.saleCount}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Base amount</span>
                <span className="font-semibold">{formatCurrency(payout.baseAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Bonus amount</span>
                <span className="font-semibold">{formatCurrency(payout.bonusAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-base">
                <span className="font-semibold">Estimated payout</span>
                <span className="font-semibold text-indigo-700">{formatCurrency(payout.totalAmount)}</span>
              </div>
            </div>
          </article>
        </section>

        {loadingLeads ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Loading partner metrics...
          </div>
        ) : null}
      </div>
    </AuthGate>
  );
}
