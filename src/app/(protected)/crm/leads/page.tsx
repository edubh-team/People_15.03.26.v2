"use client";

import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { EmployeeLeadsView } from "@/components/leads/EmployeeLeadsView";
import { MasterLeadsView } from "@/components/admin/MasterLeadsView";
import { canAccessCrm, canUseCrmInspector } from "@/lib/crm/access";
import { useSearchParams } from "next/navigation";
import type { CrmWorkbenchTabId } from "@/lib/crm/workbench";
import type { CrmSurfaceMode } from "@/components/leads/CrmSurfaceRail";
import type { CrmWorkbenchLayoutMode } from "@/components/leads/CrmWorkbench";

const WORKBENCH_TAB_IDS: CrmWorkbenchTabId[] = [
  "new_leads",
  "worked_leads",
  "due_today",
  "no_activity_24h",
  "payment_follow_up",
  "callbacks",
  "my_closures",
];

function parseWorkbenchTabId(value: string | null): CrmWorkbenchTabId | null {
  if (!value) return null;
  return WORKBENCH_TAB_IDS.includes(value as CrmWorkbenchTabId)
    ? (value as CrmWorkbenchTabId)
    : null;
}

function getSurfaceSelection(surface: string | null): {
  activeSurface: CrmSurfaceMode;
  initialTab: CrmWorkbenchTabId | null;
  focusInspector: boolean;
  initialLayout: CrmWorkbenchLayoutMode;
} {
  switch (surface) {
    case "workbench":
      return { activeSurface: "workbench", initialTab: null, focusInspector: false, initialLayout: "compact" };
    case "new":
      return { activeSurface: "new", initialTab: "new_leads", focusInspector: false, initialLayout: "compact" };
    case "worked":
      return { activeSurface: "worked", initialTab: "worked_leads", focusInspector: false, initialLayout: "compact" };
    case "inspector":
      return { activeSurface: "inspector", initialTab: null, focusInspector: true, initialLayout: "cards" };
    default:
      return { activeSurface: "workbench", initialTab: null, focusInspector: false, initialLayout: "compact" };
  }
}

function normalizeLayout(layout: string | null, fallback: CrmWorkbenchLayoutMode): CrmWorkbenchLayoutMode {
  if (layout === "compact" || layout === "cards") return layout;
  return fallback;
}

export default function CrmLeadsPage() {
  const { userDoc } = useAuth();
  const searchParams = useSearchParams();
  const useInspector = canUseCrmInspector(userDoc);
  const surface = searchParams.get("surface");
  const tab = parseWorkbenchTabId(searchParams.get("tab"));
  const leadIdParam = searchParams.get("leadId");
  const importRequested = searchParams.get("import") === "1";
  const focusLeadId = leadIdParam?.trim() ? leadIdParam.trim() : null;
  const selection = getSurfaceSelection(surface);
  const initialTab = tab ?? selection.initialTab;
  const layout = normalizeLayout(searchParams.get("layout"), selection.initialLayout);
  const selectionToken = `${surface ?? "workbench"}:${initialTab ?? "auto"}:${layout}:${importRequested ? "import" : "default"}`;

  return (
    <AuthGate allowIf={(user) => canAccessCrm(user)}>
      {useInspector ? (
        <MasterLeadsView
          initialTab={initialTab}
          selectionToken={selectionToken}
          activeSurface={selection.activeSurface}
          focusInspector={selection.focusInspector}
          initialLayout={layout}
          initialImportOpen={importRequested}
          focusLeadId={focusLeadId}
        />
      ) : (
        <EmployeeLeadsView
          initialTab={initialTab}
          selectionToken={selectionToken}
          activeSurface={selection.activeSurface}
          initialLayout={layout}
          initialImportOpen={importRequested}
          focusLeadId={focusLeadId}
        />
      )}
    </AuthGate>
  );
}
