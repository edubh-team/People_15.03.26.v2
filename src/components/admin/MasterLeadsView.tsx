"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LeadDoc } from "@/lib/types/crm";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import LeadInspector from "@/components/super-admin/LeadInspector";
import { useAuth } from "@/components/auth/AuthProvider";
import { canUseGlobalCrmView, getCrmScopeUids } from "@/lib/crm/access";
import { canBulkImportLeads } from "@/lib/access";
import { useTeamManagementScope } from "@/lib/hooks/useTeamManagementScope";
import { CrmWorkbench } from "@/components/leads/CrmWorkbench";
import { getRoleLayoutProfile } from "@/lib/layouts/role-layout";
import { CrmSurfaceRail, type CrmSurfaceMode } from "@/components/leads/CrmSurfaceRail";
import type { CrmWorkbenchTabId } from "@/lib/crm/workbench";
import type { CrmWorkbenchLayoutMode } from "@/components/leads/CrmWorkbench";

export function MasterLeadsView({
  initialTab = null,
  selectionToken = null,
  activeSurface = "workbench",
  focusInspector = false,
  initialLayout = "cards",
  initialImportOpen = false,
  focusLeadId = null,
}: {
  initialTab?: CrmWorkbenchTabId | null;
  selectionToken?: string | null;
  activeSurface?: CrmSurfaceMode;
  focusInspector?: boolean;
  initialLayout?: CrmWorkbenchLayoutMode;
  initialImportOpen?: boolean;
  focusLeadId?: string | null;
}) {
  const { userDoc } = useAuth();
  const { scopedUsers } = useTeamManagementScope(userDoc);
  const allowedOwnerUids = getCrmScopeUids(userDoc, scopedUsers);
  const hasGlobalCrmView = canUseGlobalCrmView(userDoc);
  const crmLayout = useMemo(() => getRoleLayoutProfile(userDoc).crm, [userDoc]);
  const [selectedLead, setSelectedLead] = useState<LeadDoc | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const memberLookup = useMemo(() => {
    const entries = new Map<string, string>();
    if (userDoc) {
      entries.set(userDoc.uid, userDoc.displayName ?? userDoc.email ?? userDoc.uid);
    }
    scopedUsers.forEach((user) => {
      entries.set(user.uid, user.displayName ?? user.email ?? user.uid);
    });
    return Object.fromEntries(entries);
  }, [scopedUsers, userDoc]);

  const handleEdit = (lead: LeadDoc) => {
    setSelectedLead(lead);
    setIsEditModalOpen(true);
  };

  useEffect(() => {
    if (!focusInspector || !crmLayout.showLeadInspector) return;
    inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [crmLayout.showLeadInspector, focusInspector]);

  if (!userDoc) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <CrmSurfaceRail activeSurface={activeSurface} showInspector={crmLayout.showLeadInspector} />
        <CrmWorkbench
          currentUser={userDoc}
          scopeUids={allowedOwnerUids}
          memberLookup={memberLookup}
          heading={hasGlobalCrmView ? "CRM Command Workbench" : "Manager Workbench"}
          description={
            hasGlobalCrmView
              ? "Track fresh leads, stale follow-ups, payment-stage deals, and closures from one live command surface."
              : "Start with the queues that need intervention first, then drill into the wider team pipeline below."
          }
          initialTab={initialTab}
          selectionToken={selectionToken}
          initialLayout={initialLayout}
          allowImport={hasGlobalCrmView || canBulkImportLeads(userDoc)}
          initialImportOpen={initialImportOpen}
          focusLeadId={focusLeadId}
        />

        {crmLayout.showLeadInspector ? (
          <section ref={inspectorRef} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-slate-900">Lead Inspector</h2>
              <p className="mt-1 text-sm text-slate-500">
                {hasGlobalCrmView
                  ? "Global CRM inspection across the entire pipeline."
                  : "Scoped CRM inspection for your reporting chain."}
              </p>
            </div>
            <LeadInspector onViewDetails={handleEdit} allowedOwnerUids={allowedOwnerUids} />
          </section>
        ) : null}
      </div>

      {selectedLead ? (
        <LeadDetailPanel
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          lead={selectedLead}
          currentUser={userDoc}
        />
      ) : null}
    </div>
  );
}
