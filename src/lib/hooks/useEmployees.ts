import { useState, useEffect, useMemo, useRef, MutableRefObject } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  QuerySnapshot,
  QueryDocumentSnapshot,
  DocumentData,
  limit, 
  Timestamp 
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";

export type UseEmployeesOptions = {
  uid: string | null;
  role: string | undefined;
  orgRole: string | undefined | null;
};

export type EmployeeStatus = "active" | "inactive" | "offline";

export type PresenceDoc = {
  lastSeen?: Timestamp | Date | string;
  status?: string;
  [key: string]: unknown;
};

export function useEmployees({ uid, role, orgRole }: UseEmployeesOptions) {
  const [employees, setEmployees] = useState<UserDoc[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceDoc>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs for dynamic subscriptions to avoid memory leaks and infinite loops
  const indirectReportsToUnsubs = useRef<(() => void)[]>([]);
  const indirectTeamLeadIdUnsubs = useRef<(() => void)[]>([]);
  const lastReportsToIds = useRef<string>("");
  const lastTeamLeadIdIds = useRef<string>("");

  useEffect(() => {
    if (!uid || !role) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubs: (() => void)[] = [];

    // Cleanup helper for dynamic listeners
    const cleanupIndirects = () => {
      indirectReportsToUnsubs.current.forEach(u => u());
      indirectTeamLeadIdUnsubs.current.forEach(u => u());
      indirectReportsToUnsubs.current = [];
      indirectTeamLeadIdUnsubs.current = [];
    };

    // Add cleanup to main unsubs
    unsubs.push(cleanupIndirects);

    // Helper to process snapshots safely
    const handleSnapshot = (snap: QuerySnapshot<DocumentData>) => {
      const docs = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ ...d.data(), uid: d.id } as UserDoc));
      setEmployees(prev => {
        const map = new Map(prev.map(u => [u.uid, u]));
        docs.forEach((d: UserDoc) => map.set(d.uid, d));
        return Array.from(map.values());
      });
    };

    const handleError = (err: unknown, context: string) => {
      const errorObj = err as { code?: string; message?: string };
      if (errorObj?.code === "permission-denied") {
        // Silently ignore permission errors in console
        return;
      }
      console.error(`Error fetching ${context}:`, err);
      setError(errorObj?.message || String(err));
    };

    // Helper to setup indirect listeners
    const setupIndirects = (ids: string[], unsubsRef: MutableRefObject<(() => void)[]>, sourcePrefix: string) => {
      // Cleanup previous for this stream
      unsubsRef.current.forEach(u => u());
      unsubsRef.current = [];
      
      if (ids.length === 0 || !db) return;

      // Chunking for 'in' query (limit 10)
      const chunks = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }
      
      chunks.forEach((chunkIds) => {
        // Fetch by reportsTo
        const qIndirect = query(
          collection(db!, "users"), 
          where("reportsTo", "in", chunkIds)
        );
        unsubsRef.current.push(onSnapshot(qIndirect, s => handleSnapshot(s), e => handleError(e, `${sourcePrefix} Indirect reportsTo`)));

        // Fetch by teamLeadId (Fallback/Redundancy)
        const qIndirectTL = query(
          collection(db!, "users"), 
          where("teamLeadId", "in", chunkIds)
        );
        unsubsRef.current.push(onSnapshot(qIndirectTL, s => handleSnapshot(s), e => handleError(e, `${sourcePrefix} Indirect teamLeadId`)));
      });
    };

    try {
      if (!db) throw new Error("Firebase DB not initialized");

      if (orgRole === "SUPER_ADMIN") {
        // 1. Super Admin: Fetch ALL employees (limit 1000 for safety)
        const q = query(collection(db, "users"), limit(1000));
        unsubs.push(onSnapshot(q, s => handleSnapshot(s), e => handleError(e, "All Users")));
        
      } else if (role === "teamLead") {
        // 2. Team Lead: Fetch direct reports
        const q = query(collection(db, "users"), where("reportsTo", "==", uid));
        unsubs.push(onSnapshot(q, s => handleSnapshot(s), e => handleError(e, "Direct Reports")));
        
      } else if (orgRole === "MANAGER") {
        // 3. Manager: Fetch Team Leads AND their reports
        
        // A. Direct Reports (via reportsTo)
        const qDirect = query(collection(db, "users"), where("reportsTo", "==", uid));
        unsubs.push(onSnapshot(qDirect, (snap) => {
          handleSnapshot(snap);
          
          const ids = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => d.id).sort();
          const idsStr = ids.join(",");
          
          // Only re-subscribe if IDs changed
          if (idsStr !== lastReportsToIds.current) {
             lastReportsToIds.current = idsStr;
             setupIndirects(ids, indirectReportsToUnsubs, "Manager(reportsTo)");
          }
        }, e => handleError(e, "Manager Direct reportsTo")));

        // B. Direct Reports (via teamLeadId - e.g. if Manager acts as TL)
        const qDirectTL = query(collection(db, "users"), where("teamLeadId", "==", uid));
        unsubs.push(onSnapshot(qDirectTL, (snap) => {
          handleSnapshot(snap);
          
          const ids = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => d.id).sort();
          const idsStr = ids.join(",");
          
          if (idsStr !== lastTeamLeadIdIds.current) {
             lastTeamLeadIdIds.current = idsStr;
             setupIndirects(ids, indirectTeamLeadIdUnsubs, "Manager(teamLeadId)");
          }
        }, e => handleError(e, "Manager Direct teamLeadId")));

        // Also fetch by managerId to be safe (catch-all for the branch)
        const qManagerBranch = query(collection(db, "users"), where("managerId", "==", uid));
        unsubs.push(onSnapshot(qManagerBranch, s => handleSnapshot(s), e => handleError(e, "Manager Branch")));
      }
    } catch (err) {
      console.error("Setup error:", err);
      setError(err instanceof Error ? err.message : "Unknown setup error");
    }
    
    return () => unsubs.forEach(u => u());
  }, [uid, role, orgRole]);

  // Secondary Effect: Fetch Presence for loaded employees
  useEffect(() => {
    if (employees.length === 0 || !db) return;

    const uids = employees.map(e => e.uid);
    // Chunking for presence
    const chunks = [];
    for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

    const unsubs: (() => void)[] = [];
    chunks.forEach(chunkIds => {
      const q = query(collection(db!, "presence"), where("uid", "in", chunkIds));
      unsubs.push(onSnapshot(q, snap => {
        const updates: Record<string, PresenceDoc> = {};
        snap.forEach(d => {
          updates[d.id] = d.data() as PresenceDoc;
        });
        setPresence(prev => ({ ...prev, ...updates }));
      }));
    });

    return () => unsubs.forEach(u => u());
  }, [employees]); // Re-run if employees list changes

  // Derived State: Active Employees
  const activeEmployees = useMemo(() => {
    return employees.filter(u => {
      // 1. Status Check (Case Insensitive)
      const statusActive = u.status?.toLowerCase() === "active" || u.isActive === true;
      
      // 2. Presence Check (Last 5 mins)
      const p = presence[u.uid];
      let isOnline = false;
      if (p?.lastSeen) {
        const lastSeenDate = p.lastSeen instanceof Timestamp ? p.lastSeen.toDate() : new Date(p.lastSeen);
        const diff = (new Date().getTime() - lastSeenDate.getTime()) / 1000 / 60; // mins
        if (diff < 5) isOnline = true;
      }
      if (p?.status === "checked_in") isOnline = true;

      // User is active if account is active. 
      // User is "Online" if presence says so.
      // The prompt asks for "Active Employees: Filters... where status === 'Active' OR lastSeen < 5 mins"
      // This implies "Active" means "Currently Working" OR "Account Active"? 
      // Usually "Active Employee" means account status. "Online" means presence.
      // But the prompt says "Active Employees: Filters... where status === 'Active' or where a lastSeen timestamp is within the last 5 minutes."
      // I will follow the prompt strictly: Include if status is active OR recently seen.
      return statusActive || isOnline;
    });
  }, [employees, presence]);

  return {
    employees,
    activeEmployees,
    presence,
    loading,
    error
  };
}
