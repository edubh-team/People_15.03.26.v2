"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { upsertUserDoc } from "@/lib/firebase/users";
import { getRoleLayoutProfile, type AppWorkspace } from "@/lib/layouts/role-layout";

type Workspace = AppWorkspace;

type WorkspaceState = {
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { userDoc, firebaseUser } = useAuth();
  const [workspace, setWorkspaceState] = useState<Workspace>("HR");
  const hasLoadedWorkspacePreference = useRef(false);

  const layoutProfile = useMemo(() => getRoleLayoutProfile(userDoc), [userDoc]);
  const preferredWorkspace = (userDoc?.settings?.workspace ?? null) as Workspace | null;
  const availableWorkspaces = layoutProfile.availableWorkspaces;
  const defaultWorkspace = layoutProfile.defaultWorkspace;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ui.workspace");
      if (raw === "CRM" || raw === "HR") {
        setWorkspaceState(raw);
      }
    } catch {}
    hasLoadedWorkspacePreference.current = true;
  }, []);

  const setWorkspace = useCallback(
    async (w: Workspace) => {
      const nextWorkspace = availableWorkspaces.includes(w) ? w : defaultWorkspace;
      setWorkspaceState(nextWorkspace);
      try {
        window.localStorage.setItem("ui.workspace", nextWorkspace);
      } catch {}
      if (firebaseUser) {
        await upsertUserDoc(firebaseUser.uid, {
          settings: { workspace: nextWorkspace },
        });
      }
    },
    [availableWorkspaces, defaultWorkspace, firebaseUser],
  );

  useEffect(() => {
    if (!hasLoadedWorkspacePreference.current) return;
    if (!availableWorkspaces.includes(workspace)) {
      setWorkspaceState(defaultWorkspace);
    }
  }, [availableWorkspaces, defaultWorkspace, workspace]);

  const effectiveWorkspace: Workspace =
    preferredWorkspace && availableWorkspaces.includes(preferredWorkspace)
      ? preferredWorkspace
      : availableWorkspaces.includes(workspace)
      ? workspace
      : defaultWorkspace;
  const value = useMemo<WorkspaceState>(
    () => ({ workspace: effectiveWorkspace, setWorkspace }),
    [effectiveWorkspace, setWorkspace],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
