"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { CrmWorkbench } from "@/components/leads/CrmWorkbench";
import { CrmSurfaceRail, type CrmSurfaceMode } from "@/components/leads/CrmSurfaceRail";
import type { CrmWorkbenchTabId } from "@/lib/crm/workbench";
import type { CrmWorkbenchLayoutMode } from "@/components/leads/CrmWorkbench";
import { canBulkImportLeads } from "@/lib/access";
import { useIdentityScopeUids } from "@/lib/hooks/useIdentityScopeUids";

export function EmployeeLeadsView({
  initialTab = null,
  selectionToken = null,
  activeSurface = "workbench",
  initialLayout = "cards",
  initialImportOpen = false,
  focusLeadId = null,
}: {
  initialTab?: CrmWorkbenchTabId | null;
  selectionToken?: string | null;
  activeSurface?: CrmSurfaceMode;
  initialLayout?: CrmWorkbenchLayoutMode;
  initialImportOpen?: boolean;
  focusLeadId?: string | null;
}) {
  const { userDoc } = useAuth();
  const identityScopeUids = useIdentityScopeUids(userDoc);

  const memberLookup = useMemo(() => {
    if (!userDoc) return {};
    return {
      [userDoc.uid]: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
    };
  }, [userDoc]);

  if (!userDoc) return null;

  return (
    <div className="min-h-screen bg-[#F5F5F7] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <CrmSurfaceRail activeSurface={activeSurface} />
        <CrmWorkbench
          currentUser={userDoc}
          scopeUids={identityScopeUids.length > 0 ? identityScopeUids : [userDoc.uid]}
          memberLookup={memberLookup}
          heading="BDA Workbench"
          description="Open one page, work the next-best lead, and move through your queue without hunting for the right screen."
          initialTab={initialTab}
          selectionToken={selectionToken}
          initialLayout={initialLayout}
          allowImport={canBulkImportLeads(userDoc)}
          initialImportOpen={initialImportOpen}
          focusLeadId={focusLeadId}
        />
      </div>
    </div>
  );
}
