"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { collection, onSnapshot, query, where, Timestamp, FirestoreError } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import type { UserDoc } from "@/lib/types/user";
import { canManageTeam, isHrUser } from "@/lib/access";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import { motion, AnimatePresence } from "framer-motion";
import EmployeeDossierModal from "@/components/super-admin/EmployeeDossierModal";
import { getTaskAssignee, normalizeTaskDoc } from "@/lib/tasks/model";

import { RoleBadge } from "@/components/RoleBadge";

// --- Types ---

type UserNode = UserDoc & { children: UserNode[] };

type PresenceRow = {
  uid: string;
  status: "checked_in" | "checked_out" | "on_leave";
  checkedInAt: Timestamp | Date | string | number | null;
  checkedOutAt: Timestamp | Date | string | number | null;
  lastSeen?: Timestamp | Date | string | number | null;
};

type TaskDocLite = {
  id: string;
  assignedTo: string | null;
  assigneeUid?: string | null;
  status: "pending" | "in_progress" | "completed";
  deadline?: Timestamp | Date | string | number | null;
};

// --- Helpers ---

function chunk<T>(arr: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const buildScopeTree = (allUsers: UserDoc[], currentUser: UserDoc | null): UserNode[] => {
  // 1. Filter out Super Admins (case-insensitive check)
  const visibleUsers = allUsers.filter(u => {
    const role = (u.orgRole || "").toUpperCase();
    return role !== "SUPER_ADMIN";
  });

  // 2. Convert flat list to ID-map for easy lookup
  const map: Record<string, UserNode> = {};
  visibleUsers.forEach((u) => {
    map[u.uid] = { ...u, children: [] };
  });

  const roots: UserNode[] = [];

  // 3. Build the full tree (assign children to parents based on 'reportsTo')
  visibleUsers.forEach((u) => {
    const parentUid = getEffectiveReportsToUid(u);
    if (parentUid && map[parentUid]) {
      map[parentUid].children.push(map[u.uid]);
    } else {
      roots.push(map[u.uid]);
    }
  });

  // 4. Filter based on Current User Role
  if (!currentUser) return [];

  const isSuperAdmin = 
    (currentUser.orgRole || "").toUpperCase() === "SUPER_ADMIN" || 
    (currentUser.role || "").toUpperCase() === "SUPER_ADMIN";
  
  const isHR = (currentUser.role || "").toUpperCase() === "HR";

  if (isSuperAdmin) {
    return roots;
  }

  // If HR, return employees assigned to this HR
  if (isHR) {
    const assignedEmployees = visibleUsers.filter(u => u.assignedHR === currentUser.uid);
    // Convert assigned employees to nodes, but we also need to maintain their hierarchy if needed.
    // However, the request specifically asks for "list of all the employees/designations who are assigned to these respective HR".
    // It doesn't explicitly ask for hierarchy preservation for HR view, but typically a directory implies hierarchy.
    // If we just return the list, they will be root nodes.
    // Let's check if any of these assigned employees have children who are ALSO assigned to this HR? 
    // Or just show all assigned employees as a flat list or their natural hierarchy?
    // Given the prompt "make sure that the HR has the list of all the employees... who are assigned to these respective HR",
    // a flat list or a filtered hierarchy where only assigned employees are shown seems appropriate.
    // If we use the 'map' built earlier, we can find the nodes.
    
    // Approach: Return all assigned employees as top-level nodes for the HR view, 
    // effectively flattening the view or just showing them. 
    // But wait, the existing code builds a tree.
    // If we just want to see assigned employees, we can filter the 'visibleUsers' before building the tree?
    // No, 'buildScopeTree' builds the tree from 'visibleUsers'.
    
    // Let's modify the return.
    // If we return the nodes from the map corresponding to assigned employees:
    return assignedEmployees.map(u => map[u.uid]).filter(Boolean);
  }

  // If not Super Admin or HR, return only the tree rooted at the current user
  if (map[currentUser.uid]) {
    return [map[currentUser.uid]];
  }

  // If current user is not in the map (e.g. filtered out or data issue), return nothing to be safe
  return [];
};

// --- Components ---

function ShimmerRow() {
  return (
    <div className="mb-2 flex items-center justify-between rounded-xl border border-slate-100 bg-white/40 p-3">
       <div className="flex items-center gap-3 flex-1">
         <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
         <div className="space-y-2">
           <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
           <div className="h-2 w-20 animate-pulse rounded bg-slate-200" />
         </div>
       </div>
       <div className="h-6 w-16 animate-pulse rounded-full bg-slate-200" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 mb-4">
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-slate-900">No employees found</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-xs mx-auto">
        There are no employees in this department or hierarchy branch yet.
      </p>
    </div>
  );
}

function StatusCapsule({ status, taskCompletion, lastSeen }: { 
  status: string; 
  taskCompletion: number; 
  lastSeen?: Timestamp | Date | string | number | null 
}) {
  let isOnline = status === "checked_in";
  
  if (!isOnline && lastSeen) {
     const last = lastSeen instanceof Timestamp ? lastSeen.toDate() : new Date(lastSeen);
     const diff = (new Date().getTime() - last.getTime()) / 1000 / 60;
     if (diff < 5) isOnline = true;
  }

  const label = isOnline ? "Online" : status === "on_leave" ? "On Leave" : "Offline";
  
  // Status Colors
  const statusStyles = isOnline 
    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" 
    : status === "on_leave" 
      ? "bg-amber-50 text-amber-700 ring-amber-600/20" 
      : "bg-slate-50 text-slate-600 ring-slate-500/10";

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusStyles}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-500" : status === "on_leave" ? "bg-amber-500" : "bg-slate-400"}`} />
        {label}
      </span>
      {taskCompletion > 0 && (
         <div className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
           <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
           </svg>
           {taskCompletion}%
         </div>
      )}
    </div>
  );
}

function EmployeeNode({ 
  node, 
  depth, 
  presence, 
  tasks, 
  searchMap,
  onView,
  isLast = false
}: { 
  node: UserNode; 
  depth: number; 
  presence: Record<string, PresenceRow>; 
  tasks: Record<string, TaskDocLite[]>;
  searchMap?: Record<string, { self: boolean; descendant: boolean }>;
  onView: (u: UserNode) => void;
  isLast?: boolean;
}) {
  const matchInfo = searchMap ? searchMap[node.uid] : undefined;
  const isMatch = matchInfo?.self;
  const hasMatchingDescendant = matchInfo?.descendant;
  
  const shouldBeOpen = searchMap && Object.keys(searchMap).length > 0
    ? (isMatch || hasMatchingDescendant)
    : depth < 1;

  const [isOpen, setIsOpen] = useState(shouldBeOpen);
  const [prevSearchMap, setPrevSearchMap] = useState(searchMap);

  // Sync state with props (searchMap) changes
  if (searchMap !== prevSearchMap) {
    let target = isOpen;
    const isSearchActive = searchMap && Object.keys(searchMap).length > 0;
    
    if (isSearchActive) {
      target = !!(isMatch || hasMatchingDescendant);
    } else {
        if (depth < 1) target = true;
    }
    
    setPrevSearchMap(searchMap);
    if (target !== isOpen) {
        setIsOpen(target);
    }
  }

  const hasChildren = node.children && node.children.length > 0;
  
  // Stats
  const userPresence = presence[node.uid];
  const presenceStatus = userPresence?.status ?? "checked_out";
  const lastSeen = userPresence?.lastSeen;
  
  // Check online status for the dot
  let isOnline = presenceStatus === "checked_in";
  if (!isOnline && lastSeen) {
     const last = lastSeen instanceof Timestamp ? lastSeen.toDate() : new Date(lastSeen);
     const diff = (new Date().getTime() - last.getTime()) / 1000 / 60;
     if (diff < 5) isOnline = true;
  }
  
  const isOnLeave = presenceStatus === "on_leave";

  const userTasks = tasks[node.uid] ?? [];
  const completed = userTasks.filter(t => t.status === "completed").length;
  const taskPct = userTasks.length > 0 ? Math.round((completed / userTasks.length) * 100) : 0;

  return (
    <div className="relative">
      {/* Tree Lines */}
      {depth >= 0 && (
        <>
          {/* 1. Curved Connector (Top -> Center -> Right) */}
          <div 
            className={`
              absolute top-0
              border-l-2 border-b-2 border-slate-300 rounded-bl-2xl
              ${depth === 0 ? "left-[-1rem] w-4 h-9 sm:h-10" : "left-[-1rem] w-4 h-9 sm:left-[-2rem] sm:w-8 sm:h-10"}
            `}
          />
          
          {/* 2. Vertical Spine Continuation (Center -> Bottom) */}
          {!isLast && (
            <div 
              className={`
                absolute bottom-0 bg-slate-300 w-0.5
                ${depth === 0 ? "left-[-1rem] top-9 sm:top-10" : "left-[-1rem] top-9 sm:left-[-2rem] sm:top-10"}
              `} 
            />
          )}
        </>
      )}
      
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`
          group relative mb-3 flex items-center justify-between rounded-2xl border p-3 sm:p-4 transition-all duration-200
          ${isMatch ? "ring-2 ring-indigo-500 bg-indigo-50/50 border-indigo-200 shadow-md" : ""}
          ${depth === 0 ? "bg-white shadow-sm border-slate-200 hover:shadow-md hover:border-indigo-300" : "bg-white/80 backdrop-blur-sm border-slate-200 hover:bg-white hover:shadow-sm hover:border-indigo-200"}
          ${depth > 0 ? "ml-4 sm:ml-8" : ""}
        `}
      >
        <div className="flex items-center gap-3 sm:gap-4 cursor-pointer flex-1" onClick={() => hasChildren && setIsOpen(!isOpen)}>
          {/* Avatar with Apple-style Status Dot */}
          <div className="relative h-10 w-10 sm:h-11 sm:w-11 shrink-0">
             <div className="h-full w-full overflow-hidden rounded-full border-2 border-white shadow-sm ring-1 ring-slate-200 group-hover:ring-indigo-300 transition-all">
                {node.photoURL ? (
                  <img src={node.photoURL} alt={node.displayName ?? ""} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-indigo-50 text-indigo-600 font-bold text-sm">
                    {(node.displayName?.[0] ?? "U").toUpperCase()}
                  </div>
                )}
             </div>
             
             {/* Status Dot */}
             {(isOnline || isOnLeave) && (
               <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 z-10">
                 {isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                 <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white shadow-sm ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`}></span>
               </span>
             )}

             {hasChildren && (
               <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 z-20 hover:bg-slate-50 transition-colors">
                  <svg 
                    className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} 
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
               </div>
             )}
          </div>

          <div>
            <h3 className={`text-slate-900 group-hover:text-indigo-900 transition-colors ${depth === 0 ? "font-bold text-base" : "font-semibold text-sm"}`}>
              {node.displayName}
            </h3>
            <div className="mt-1">
              <RoleBadge role={node.role} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-6">
          <div className="hidden sm:block">
            <StatusCapsule status={presenceStatus} taskCompletion={taskPct} lastSeen={lastSeen} />
          </div>
          {/* Mobile Status: Just the dot in avatar is enough? Or maybe a small indicator? 
              The StatusCapsule is quite wide. 
              Let's keep it hidden on very small screens or make a mini version?
              For now, hidden on mobile to save space, relying on the Avatar dot for presence. 
              But Task Completion is lost.
              Let's show a mini task indicator on mobile if space permits.
          */}
          <div className="sm:hidden">
             {taskPct > 0 && (
               <div className="flex items-center gap-1 text-xs font-medium text-indigo-600">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {taskPct}%
               </div>
             )}
          </div>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onView(node);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:bg-slate-50 hover:text-indigo-600 hover:shadow-md active:scale-95"
          >
            <span className="hidden sm:inline">View Dossier</span>
            <span className="sm:hidden">
               <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                 <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                 <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
               </svg>
            </span>
            <svg className="hidden sm:block h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {isOpen && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative"
          >
            {node.children.map((child, idx) => (
              <EmployeeNode 
                key={child.uid} 
                node={child} 
                depth={depth + 1} 
                presence={presence}
                tasks={tasks}
                searchMap={searchMap}
                onView={onView}
                isLast={idx === node.children.length - 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function TeamDirectoryPage() {
  const { userDoc } = useAuth();
  const { users: allUsers, loading: usersLoading } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: false,
  });
  const [presence, setPresence] = useState<Record<string, PresenceRow>>({});

  useEffect(() => {
    if (!db || allUsers.length === 0) {
      setPresence({});
      return;
    }

    const firestore = db;
    const buckets = new Map<string, Record<string, PresenceRow>>();
    const uids = Array.from(new Set(allUsers.map((user) => user.uid).filter(Boolean)));
    const unsubscribers = chunk(uids).map((uidChunk, index) =>
      onSnapshot(
        query(collection(firestore, "presence"), where("uid", "in", uidChunk)),
        (snapshot) => {
          const bucket: Record<string, PresenceRow> = {};
          snapshot.forEach((doc) => {
            bucket[doc.id] = doc.data() as PresenceRow;
          });
          buckets.set(`presence-${index}`, bucket);

          const nextPresence: Record<string, PresenceRow> = {};
          buckets.forEach((row) => Object.assign(nextPresence, row));
          setPresence(nextPresence);
        },
        (error) => {
          const firestoreError = error as FirestoreError;
          if (firestoreError.code !== "permission-denied") {
            console.error("Error fetching presence:", error);
          }
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [allUsers]);

  const [tasks, setTasks] = useState<Record<string, TaskDocLite[]>>({});
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    if (allUsers.length === 0 || !db) {
      setTasks({});
      return;
    }

    const firestore = db;
    const buckets = new Map<string, Record<string, TaskDocLite[]>>();
    const uids = Array.from(new Set(allUsers.map((user) => user.uid).filter(Boolean)));
    const unsubscribers: (() => void)[] = [];

    const syncTasks = () => {
      const merged = new Map<string, Map<string, TaskDocLite>>();

      buckets.forEach((bucket) => {
        Object.entries(bucket).forEach(([assignee, rows]) => {
          if (!merged.has(assignee)) {
            merged.set(assignee, new Map<string, TaskDocLite>());
          }

          const assigneeTasks = merged.get(assignee);
          rows.forEach((task) => assigneeTasks?.set(task.id, task));
        });
      });

      const nextTasks: Record<string, TaskDocLite[]> = {};
      merged.forEach((rows, assignee) => {
        nextTasks[assignee] = Array.from(rows.values());
      });
      setTasks(nextTasks);
    };

    const handleSnapshot = (
      key: string,
      snapshot: {
        forEach: (
          callback: (doc: { id: string; data: () => Record<string, unknown> }) => void,
        ) => void;
      },
    ) => {
      const bucket: Record<string, TaskDocLite[]> = {};
      snapshot.forEach((doc) => {
        const task = normalizeTaskDoc(doc.data(), doc.id) as unknown as TaskDocLite;
        const assignee = getTaskAssignee(task);
        if (!assignee) return;

        if (!bucket[assignee]) {
          bucket[assignee] = [];
        }
        bucket[assignee].push(task);
      });

      buckets.set(key, bucket);
      syncTasks();
    };

    const handleError = (error: unknown) => {
      const firestoreError = error as FirestoreError;
      if (firestoreError.code !== "permission-denied") {
        console.error(error);
      }
    };

    chunk(uids).forEach((uidChunk, index) => {
      unsubscribers.push(
        onSnapshot(
          query(collection(firestore, "tasks"), where("assignedTo", "in", uidChunk)),
          (snapshot) => handleSnapshot(`assigned-${index}`, snapshot),
          handleError,
        ),
        onSnapshot(
          query(collection(firestore, "tasks"), where("assigneeUid", "in", uidChunk)),
          (snapshot) => handleSnapshot(`legacy-assignee-${index}`, snapshot),
          handleError,
        ),
      );
    });

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [allUsers]);

  // Build Hierarchy (Scoped)
  const treeData = useMemo(() => {
    return buildScopeTree(allUsers, userDoc);
  }, [allUsers, userDoc]);

  // Search Logic
  const searchMap = useMemo(() => {
    const map: Record<string, { self: boolean; descendant: boolean }> = {};
    if (!search.trim()) return map;

    const term = search.toLowerCase();
    
    const check = (nodes: UserNode[]): boolean => {
      let anyChildMatch = false;
      for (const node of nodes) {
        const self = (node.displayName ?? "").toLowerCase().includes(term) || (node.email ?? "").toLowerCase().includes(term);
        const childMatch = check(node.children);
        
        map[node.uid] = { self, descendant: childMatch };
        if (self || childMatch) anyChildMatch = true;
      }
      return anyChildMatch;
    };

    check(treeData);
    return map;
  }, [treeData, search]);

  const handleViewDossier = (node: UserNode) => {
    setSelectedEmployeeId(node.uid);
  };

  return (
    <AuthGate allowIf={(user) => canManageTeam(user) || isHrUser(user)}>
      <div className="min-h-screen bg-slate-50/50 p-6 lg:p-10">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Employee Directory</h1>
              <p className="text-slate-500">Hierarchy & Performance Overview</p>
            </div>
            
            {/* Search */}
            <div className="relative w-full md:w-72">
               <input
                 type="text"
                 placeholder="Search employees..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="w-full rounded-xl border-0 bg-white px-4 py-2.5 pl-10 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
               />
               <svg 
                 className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" 
                 fill="none" viewBox="0 0 24 24" stroke="currentColor"
               >
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
               </svg>
            </div>
          </div>

          {/* Hierarchy Tree */}
          <div className="space-y-4">
            {usersLoading ? (
               // Shimmer Loading State
               <div className="space-y-3">
                 {[1, 2, 3, 4].map(i => <ShimmerRow key={i} />)}
               </div>
            ) : treeData.length === 0 ? (
               <EmptyState />
            ) : (
               <div className="relative pl-4">
                 
                 {treeData.map((node, idx) => (
                   <EmployeeNode 
                     key={node.uid} 
                     node={node} 
                     depth={0} 
                     presence={presence}
                     tasks={tasks}
                     searchMap={searchMap}
                     onView={handleViewDossier}
                     isLast={idx === treeData.length - 1}
                   />
                 ))}
               </div>
            )}
          </div>
        </div>
        
        <EmployeeDossierModal
          isOpen={!!selectedEmployeeId}
          onClose={() => setSelectedEmployeeId(null)}
          employeeId={selectedEmployeeId}
        />
      </div>
    </AuthGate>
  );
}
