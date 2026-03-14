"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMyUnreadNotifications, type NotificationDoc } from "@/lib/hooks/useNotifications";
import { useMyPresence } from "@/lib/hooks/useAttendance";
import { getTodayKey } from "@/lib/firebase/attendance";
import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useWorkspace } from "@/components/shell/WorkspaceProvider";
import { BellIcon, MenuIcon, NavIcon } from "./icons";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import MainLogo from "@/assets/img/main.png";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import {
  getDisplayRole,
} from "@/lib/access";
import { getCrmScopeUids } from "@/lib/crm/access";
import { searchCrmLeads } from "@/lib/crm/search";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import { useIdentityScopeUids } from "@/lib/hooks/useIdentityScopeUids";
import {
  getRoleLayoutProfile,
  getShellNavigationGroups,
  type AppNavIconName,
} from "@/lib/layouts/role-layout";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import { getLeadStatusLabel } from "@/lib/leads/status";
import { normalizeTaskDoc } from "@/lib/tasks/model";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const ROUTE_HISTORY_KEY = "ui.routeHistory";
const ROUTE_HISTORY_LIMIT = 40;
const LOCAL_SEARCH_MIN_LENGTH = 2;
const PINNED_ROUTES_KEY = "ui.pinnedRoutes";
const ROUTE_STATE_KEY = "ui.routeState";
const ROUTE_RESTORE_TARGET_KEY = "ui.routeRestoreTarget";
const RECENT_ROUTES_LIMIT = 5;

const KNOWN_ROUTE_LABELS: Record<string, string> = {
  "/my-day": "My Day",
  "/crm/leads": "CRM Leads",
  "/team": "Team Management",
  "/tasks": "Tasks",
  "/reports": "Reports",
  "/training": "Training Dashboard",
  "/attendance": "Attendance",
  "/chat": "Messages",
  "/hr": "People Ops",
  "/hr/attendance": "Attendance Ops",
  "/hr/leaves": "Leave Ops",
  "/hr/payroll": "Payroll Ops",
  "/hr/recruitment": "Recruitment",
  "/payroll": "Payroll",
  "/finance": "Finance",
  "/finance/accounts": "Accounts Directory",
  "/super-admin/mission-control": "Mission Control",
  "/super-admin/operations": "Operations",
  "/super-admin/personnel": "Personnel Studio",
  "/setup": "System Setup",
  "/profile/me": "My Profile",
};

type GlobalTaskSearchResult = {
  id: string;
  title?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  assignedTo?: string | null;
  assigneeUid?: string | null;
  status?: string | null;
  priority?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type GlobalPageSearchResult = {
  id: string;
  label: string;
  href: string;
  description?: string;
  keywords?: string[];
};

type BreadcrumbItem = {
  label: string;
  href: string;
};

type RouteStateEntry = {
  scrollY: number;
  updatedAt: number;
};

type StickyContextAction = {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function prefixRange(value: string) {
  return [value, `${value}\uf8ff`] as const;
}

function readRouteHistory() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const raw = window.sessionStorage.getItem(ROUTE_HISTORY_KEY);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .slice(-ROUTE_HISTORY_LIMIT);
  } catch {
    return [] as string[];
  }
}

function writeRouteHistory(history: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ROUTE_HISTORY_KEY,
      JSON.stringify(history.slice(-ROUTE_HISTORY_LIMIT)),
    );
  } catch {}
}

function readPinnedRoutes() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const raw = window.localStorage.getItem(PINNED_ROUTES_KEY);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
}

function writePinnedRoutes(routes: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_ROUTES_KEY, JSON.stringify(routes));
  } catch {}
}

function readRouteStateMap() {
  if (typeof window === "undefined") return {} as Record<string, RouteStateEntry>;
  try {
    const raw = window.sessionStorage.getItem(ROUTE_STATE_KEY);
    if (!raw) return {} as Record<string, RouteStateEntry>;
    const parsed = JSON.parse(raw) as Record<string, RouteStateEntry>;
    if (!parsed || typeof parsed !== "object") return {} as Record<string, RouteStateEntry>;
    return parsed;
  } catch {
    return {} as Record<string, RouteStateEntry>;
  }
}

function writeRouteStateMap(next: Record<string, RouteStateEntry>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(next));
  } catch {}
}

function saveRouteScrollState(routeKey: string, scrollY: number) {
  if (!routeKey) return;
  const map = readRouteStateMap();
  map[routeKey] = { scrollY, updatedAt: Date.now() };
  writeRouteStateMap(map);
}

function setRouteRestoreTarget(routeKey: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!routeKey) {
      window.sessionStorage.removeItem(ROUTE_RESTORE_TARGET_KEY);
      return;
    }
    window.sessionStorage.setItem(ROUTE_RESTORE_TARGET_KEY, routeKey);
  } catch {}
}

function getRouteRestoreTarget() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ROUTE_RESTORE_TARGET_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRoutePath(route: string) {
  return route.split("?")[0] || route;
}

function toTitleCaseSegment(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugifySectionLabel(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function routeLabelFromHref(
  href: string,
  routeLabels: Map<string, string>,
) {
  const direct = routeLabels.get(href);
  if (direct) return direct;

  const normalizedPath = normalizeRoutePath(href);
  const known = routeLabels.get(normalizedPath) ?? KNOWN_ROUTE_LABELS[normalizedPath];
  if (known) return known;

  const tab = new URLSearchParams(href.split("?")[1] ?? "").get("tab");
  if (tab) {
    return toTitleCaseSegment(tab);
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0) return "Home";
  return toTitleCaseSegment(segments[segments.length - 1]);
}

function buildBreadcrumbs(pathname: string, homeRoute: string, routeLabels: Map<string, string>) {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [
    {
      label: routeLabelFromHref(homeRoute, routeLabels),
      href: homeRoute,
    },
  ];

  if (segments.length === 0) return crumbs;

  let cumulative = "";
  for (const segment of segments) {
    cumulative += `/${segment}`;
    crumbs.push({
      label: routeLabelFromHref(cumulative, routeLabels),
      href: cumulative,
    });
  }

  // Avoid duplicated first crumb when home route equals current path.
  return crumbs.filter((crumb, index) => {
    if (index === 0) return true;
    return crumb.href !== crumbs[0].href || index === crumbs.length - 1;
  });
}

async function searchTasks(
  firestore: Firestore,
  term: string,
  maxResults = 8,
) {
  const trimmed = term.trim();
  if (!trimmed) return [] as GlobalTaskSearchResult[];

  const results = new Map<string, GlobalTaskSearchResult>();
  const exactTask = await getDoc(doc(firestore, "tasks", trimmed));
  if (exactTask.exists()) {
    const task = normalizeTaskDoc(
      exactTask.data() as Record<string, unknown>,
      exactTask.id,
    ) as GlobalTaskSearchResult;
    results.set(exactTask.id, task);
  }

  const searches: Array<Promise<QueryDocumentSnapshot[]>> = [
    getDocs(
      query(collection(firestore, "tasks"), where("leadId", "==", trimmed), limit(maxResults)),
    ).then((snapshot) => snapshot.docs),
  ];

  if (trimmed.length >= 2) {
    const [titleStart, titleEnd] = prefixRange(trimmed);
    searches.push(
      getDocs(
        query(
          collection(firestore, "tasks"),
          where("title", ">=", titleStart),
          where("title", "<=", titleEnd),
          limit(maxResults),
        ),
      ).then((snapshot) => snapshot.docs),
    );

    const [leadNameStart, leadNameEnd] = prefixRange(trimmed);
    searches.push(
      getDocs(
        query(
          collection(firestore, "tasks"),
          where("leadName", ">=", leadNameStart),
          where("leadName", "<=", leadNameEnd),
          limit(maxResults),
        ),
      ).then((snapshot) => snapshot.docs),
    );
  }

  const snapshots = await Promise.all(searches);
  snapshots.flat().forEach((snapshot) => {
    const task = normalizeTaskDoc(
      snapshot.data() as Record<string, unknown>,
      snapshot.id,
    ) as GlobalTaskSearchResult;
    results.set(snapshot.id, task);
  });

  return Array.from(results.values())
    .sort(
      (left, right) =>
        toMillis(right.updatedAt ?? right.createdAt) -
        toMillis(left.updatedAt ?? left.createdAt),
    )
    .slice(0, maxResults);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { userDoc, firebaseUser, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { workspace, setWorkspace } = useWorkspace();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const { count: unreadNotificationsCount, notifications } = useMyUnreadNotifications(
    firebaseUser?.uid,
  );
  const presenceQuery = useMyPresence(firebaseUser?.uid ?? null);
  const todayKey = useMemo(() => getTodayKey(), []);
  const layoutProfile = useMemo(() => getRoleLayoutProfile(userDoc), [userDoc]);
  const homeRoute = layoutProfile.homeRoute;
  const canSwitchWorkspace = layoutProfile.availableWorkspaces.length > 1;
  const { users: searchableUsers } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: false,
  });
  const identityScopeUids = useIdentityScopeUids(userDoc);
  const searchScopeUids = useMemo(
    () => {
      const baseScope = getCrmScopeUids(userDoc, searchableUsers);
      if (baseScope === null) return null;
      return Array.from(new Set([...(baseScope ?? []), ...identityScopeUids]));
    },
    [identityScopeUids, searchableUsers, userDoc],
  );
  const searchScopeKey = useMemo(
    () => (searchScopeUids === null ? "global" : searchScopeUids.join("|")),
    [searchScopeUids],
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [leadResults, setLeadResults] = useState<LeadDoc[]>([]);
  const [taskResults, setTaskResults] = useState<GlobalTaskSearchResult[]>([]);
  const [employeeResults, setEmployeeResults] = useState<UserDoc[]>([]);
  const [pageResults, setPageResults] = useState<GlobalPageSearchResult[]>([]);
  const [selectedSearchLead, setSelectedSearchLead] = useState<LeadDoc | null>(null);
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>([]);
  const [recentRoutes, setRecentRoutes] = useState<string[]>([]);
  const [hasRestorableRouteState, setHasRestorableRouteState] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const localSearchInputRef = useRef<HTMLInputElement | null>(null);
  const localSearchMarksRef = useRef<HTMLElement[]>([]);
  const localSearchActiveIndexRef = useRef(-1);
  const previousRouteKeyRef = useRef<string | null>(null);
  const [localSearchInput, setLocalSearchInput] = useState("");
  const [localSearchStats, setLocalSearchStats] = useState({ total: 0, active: 0 });
  const [localSearchNoMatch, setLocalSearchNoMatch] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [inPageSections, setInPageSections] = useState<Array<{ id: string; label: string }>>([]);
  const [activeInPageSectionId, setActiveInPageSectionId] = useState<string | null>(null);
  const inPageSectionRefreshTimerRef = useRef<number | null>(null);
  const routeKey = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  async function markAsRead(notificationId: string) {
    if (!db) return;
    try {
        const { doc, updateDoc } = await import("firebase/firestore");
        await updateDoc(doc(db as Firestore, "notifications", notificationId), { read: true });
    } catch (e) {
        console.error("Failed to mark notification as read", e);
    }
  }

  async function handleNotificationAction(n: NotificationDoc, action: "view" | "accept") {
      await markAsRead(n.id);
      if (action === "view" && n.relatedTaskId) {
          router.push(`/tasks?taskId=${n.relatedTaskId}`);
      }
      if (action === "accept" && n.relatedTaskId) {
         try {
            const { doc, updateDoc } = await import("firebase/firestore");
            if (db) {
                await updateDoc(doc(db as Firestore, "tasks", n.relatedTaskId), { status: "in_progress" });
                router.push(`/tasks?taskId=${n.relatedTaskId}`);
            }
         } catch (e) {
            console.error("Failed to accept task", e);
         }
     }
   }

  const menuVariants = {
    open: {
      height: "auto",
      opacity: 1,
      transition: { type: "spring", bounce: 0, duration: 0.4 },
    },
    closed: {
      height: 0,
      opacity: 0,
      transition: { type: "spring", bounce: 0, duration: 0.3 },
    },
  } as const;

  const listVariants = {
    open: {
      opacity: 1,
      transition: { type: "spring", stiffness: 300, damping: 30, staggerChildren: 0.06, delayChildren: 0.02 },
    },
    closed: {
      opacity: 0,
      transition: { type: "spring", stiffness: 300, damping: 30, staggerChildren: 0.04, staggerDirection: -1 },
    },
  } as const;

  const itemVariants = {
    open: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 30 } },
    closed: { opacity: 0, y: -6, transition: { type: "spring", stiffness: 300, damping: 30 } },
  } as const;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [hasHydratedUiPrefs, setHasHydratedUiPrefs] = useState(false);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  useEffect(() => {
    try {
      const collapsed = window.localStorage.getItem("ui.sidebarCollapsed");
      setSidebarCollapsed(collapsed === "1");
    } catch {}

    try {
      const raw = window.localStorage.getItem("ui.sidebar.openGroups");
      setOpenGroups(raw ? JSON.parse(raw) : {});
    } catch {
      setOpenGroups({});
    }

    try {
      const quickAccess = window.localStorage.getItem("ui.sidebar.quickAccessOpen");
      setQuickAccessOpen(quickAccess === "1");
    } catch {
      setQuickAccessOpen(false);
    }

    setPinnedRoutes(readPinnedRoutes());
    setHasHydratedUiPrefs(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedUiPrefs) return;
    try {
      window.localStorage.setItem("ui.sidebar.openGroups", JSON.stringify(openGroups));
    } catch {}
  }, [hasHydratedUiPrefs, openGroups]);

  useEffect(() => {
    if (!hasHydratedUiPrefs) return;
    writePinnedRoutes(pinnedRoutes);
  }, [hasHydratedUiPrefs, pinnedRoutes]);

  useEffect(() => {
    if (!hasHydratedUiPrefs) return;
    try {
      window.localStorage.setItem("ui.sidebar.quickAccessOpen", quickAccessOpen ? "1" : "0");
    } catch {}
  }, [hasHydratedUiPrefs, quickAccessOpen]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isPinnedRoute(href: string) {
    return pinnedRoutes.includes(href);
  }

  function togglePinnedRoute(href: string) {
    setPinnedRoutes((current) => {
      if (current.includes(href)) {
        return current.filter((entry) => entry !== href);
      }
      return [href, ...current].slice(0, 15);
    });
  }

  const groups = useMemo(() => {
    const navGroups = getShellNavigationGroups(userDoc, { workspace, pathname });
    return navGroups.map((group) => {
      const children = group.children.filter(Boolean);
      const anyActive = children.some(
        (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
      );
      return {
        ...group,
        children: children as Array<{
          label: string;
          href: string;
          icon: AppNavIconName;
        }>,
        anyActive,
        open: openGroups[group.key] ?? true,
      };
    });
  }, [openGroups, pathname, userDoc, workspace]);

  const allNavEntries = useMemo(() => {
    const entries = new Map<string, { label: string; href: string; icon: AppNavIconName; groupLabel: string }>();
    groups.forEach((group) => {
      group.children.forEach((child) => {
        if (!entries.has(child.href)) {
          entries.set(child.href, {
            label: child.label,
            href: child.href,
            icon: child.icon,
            groupLabel: group.label,
          });
        }
      });
    });
    entries.set(homeRoute, {
      label: routeLabelFromHref(homeRoute, new Map()),
      href: homeRoute,
      icon: "home",
      groupLabel: "HOME",
    });
    return Array.from(entries.values());
  }, [groups, homeRoute]);

  const routeLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    allNavEntries.forEach((entry) => {
      map.set(entry.href, entry.label);
      map.set(normalizeRoutePath(entry.href), entry.label);
    });
    Object.entries(KNOWN_ROUTE_LABELS).forEach(([href, label]) => {
      map.set(href, label);
    });
    return map;
  }, [allNavEntries]);

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(pathname, homeRoute, routeLabelMap),
    [homeRoute, pathname, routeLabelMap],
  );

  const { primaryGroups, overflowGroup } = useMemo(() => {
    return {
      primaryGroups: groups.map((group) => ({
        ...group,
        anyActive: group.children.some(
          (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
        ),
        open: openGroups[group.key] ?? true,
      })),
      overflowGroup: null,
    };
  }, [groups, openGroups, pathname]);

  const commandPageCatalog = useMemo(() => {
    const seeded = new Map<string, GlobalPageSearchResult>();
    allNavEntries.forEach((entry) => {
      seeded.set(entry.href, {
        id: `page:${entry.href}`,
        label: entry.label,
        href: entry.href,
        description: `${entry.groupLabel} page`,
        keywords: [entry.groupLabel, entry.label, normalizeRoutePath(entry.href)],
      });
    });

    [
      {
        href: CANONICAL_DOMAIN_ROUTES.CRM,
        label: "CRM Workbench",
        description: "Leads, call outcomes, reassignments",
        keywords: ["crm", "leads", "call", "follow-up"],
      },
      {
        href: CANONICAL_DOMAIN_ROUTES.REPORTS,
        label: "Reports",
        description: "KPI reports, templates, exports",
        keywords: ["reports", "kpi", "export", "template", "dashboard"],
      },
      {
        href: "/tasks",
        label: "Tasks",
        description: "Task queue and calendar workbench",
        keywords: ["tasks", "todo", "overdue", "calendar"],
      },
      {
        href: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        label: "My Day",
        description: "Action-first queue hub",
        keywords: ["my day", "home", "queue", "priority"],
      },
      {
        href: CANONICAL_DOMAIN_ROUTES.TRAINING,
        label: "Training Dashboard",
        description: "BDA trainee qualification and readiness tracking",
        keywords: ["training", "trainee", "qualification", "bdat", "bdm"],
      },
    ].forEach((entry) => {
      seeded.set(entry.href, {
        id: `page:${entry.href}`,
        ...entry,
      });
    });

    return Array.from(seeded.values());
  }, [allNavEntries]);

  const favoriteEntries = useMemo(
    () =>
      pinnedRoutes
        .map((href) => {
          const route = commandPageCatalog.find((entry) => entry.href === href);
          if (route) return route;
          return {
            id: `page:${href}`,
            href,
            label: routeLabelFromHref(href, routeLabelMap),
            description: "Pinned page",
          } as GlobalPageSearchResult;
        })
        .slice(0, RECENT_ROUTES_LIMIT),
    [commandPageCatalog, pinnedRoutes, routeLabelMap],
  );

  const recentEntries = useMemo(
    () =>
      recentRoutes
        .map((href) => {
          const route = commandPageCatalog.find((entry) => entry.href === href);
          if (route) return route;
          return {
            id: `recent:${href}`,
            href,
            label: routeLabelFromHref(href, routeLabelMap),
            description: "Recently opened",
          } as GlobalPageSearchResult;
        })
        .slice(0, RECENT_ROUTES_LIMIT),
    [commandPageCatalog, recentRoutes, routeLabelMap],
  );

  function refreshInPageSections() {
    const root = mainContentRef.current;
    if (!root) {
      setInPageSections([]);
      setActiveInPageSectionId(null);
      return;
    }

    const explicit = Array.from(root.querySelectorAll<HTMLElement>("[data-in-page-nav]"));
    const headingFallback = Array.from(root.querySelectorAll<HTMLElement>("h2, [data-section-title]"));
    const regionFallback = Array.from(
      root.querySelectorAll<HTMLElement>("section[aria-label], article[aria-label]"),
    );
    const candidates = explicit.length > 0 ? explicit : headingFallback.length > 0 ? headingFallback : regionFallback;

    const sectionList: Array<{ id: string; label: string }> = [];
    const usedIds = new Set<string>();
    const usedLabels = new Set<string>();

    for (let index = 0; index < candidates.length; index += 1) {
      const element = candidates[index];
      if (!element || element.offsetParent === null) continue;

      const rawLabel = (
        element.getAttribute("data-in-page-nav")
        || element.getAttribute("data-section-title")
        || element.getAttribute("aria-label")
        || element.textContent
        || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (rawLabel.length < 2) continue;

      const normalizedLabel = rawLabel.toLowerCase();
      if (usedLabels.has(normalizedLabel)) continue;

      let sectionId = element.id?.trim() ?? "";
      if (!sectionId) {
        const base = slugifySectionLabel(rawLabel) || `section-${index + 1}`;
        let candidate = base;
        let suffix = 2;
        while (
          usedIds.has(candidate)
          || (document.getElementById(candidate) && document.getElementById(candidate) !== element)
        ) {
          candidate = `${base}-${suffix}`;
          suffix += 1;
        }
        element.id = candidate;
        sectionId = candidate;
      }

      usedIds.add(sectionId);
      usedLabels.add(normalizedLabel);
      sectionList.push({
        id: sectionId,
        label: rawLabel.length > 42 ? `${rawLabel.slice(0, 42).trimEnd()}...` : rawLabel,
      });
      if (sectionList.length >= 8) break;
    }

    setInPageSections(sectionList);
    setActiveInPageSectionId((current) =>
      current && sectionList.some((section) => section.id === current)
        ? current
        : (sectionList[0]?.id ?? null),
    );
  }

  function scheduleInPageSectionRefresh() {
    if (typeof window === "undefined") return;
    if (inPageSectionRefreshTimerRef.current !== null) {
      window.clearTimeout(inPageSectionRefreshTimerRef.current);
    }
    inPageSectionRefreshTimerRef.current = window.setTimeout(() => {
      refreshInPageSections();
      inPageSectionRefreshTimerRef.current = null;
    }, 140);
  }

  function jumpToInPageSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    const yOffset = 132;
    const top = target.getBoundingClientRect().top + window.scrollY - yOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setActiveInPageSectionId(sectionId);
  }

  const stickyContextActions = useMemo(() => {
    const actions = [] as StickyContextAction[];
    if (pathname.startsWith(CANONICAL_DOMAIN_ROUTES.CRM)) {
      actions.push(
        { id: "assign", label: "Assign Queue", href: "/team" },
        { id: "followup", label: "Due Today", href: `${CANONICAL_DOMAIN_ROUTES.CRM}?surface=workbench&tab=due_today` },
        { id: "callbacks", label: "Callbacks", href: `${CANONICAL_DOMAIN_ROUTES.CRM}?surface=workbench&tab=callbacks` },
        { id: "export", label: "Export", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=sales` },
      );
    } else if (pathname.startsWith("/team")) {
      actions.push(
        { id: "bulk", label: "Bulk Assign", href: "/team#bulk-actions" },
        { id: "pullback", label: "Pullback Queue", href: `${CANONICAL_DOMAIN_ROUTES.CRM}?surface=workbench&tab=no_activity_24h` },
        { id: "payment", label: "Payment Queue", href: `${CANONICAL_DOMAIN_ROUTES.CRM}?surface=workbench&tab=payment_follow_up` },
        { id: "export", label: "Export", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=team` },
      );
    } else if (pathname.startsWith("/tasks")) {
      actions.push(
        { id: "task-due", label: "Due Today", href: "/tasks?quickFilter=due_today" },
        { id: "task-overdue", label: "Overdue", href: "/tasks?quickFilter=overdue" },
        { id: "task-lead", label: "Lead Linked", href: "/tasks?quickFilter=lead_linked" },
        { id: "task-export", label: "Export", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=tasks` },
      );
    } else if (pathname.startsWith(CANONICAL_DOMAIN_ROUTES.REPORTS)) {
      actions.push(
        { id: "report-sales", label: "Sales KPI", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=sales` },
        { id: "report-hr", label: "HR KPI", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=hr` },
        { id: "report-finance", label: "Finance KPI", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=finance` },
        { id: "report-open-crm", label: "Open CRM", href: CANONICAL_DOMAIN_ROUTES.CRM },
      );
    } else if (pathname.startsWith("/hr") || pathname.startsWith("/payroll")) {
      actions.push(
        { id: "hr-att", label: "Attendance", href: "/hr/attendance" },
        { id: "hr-leaves", label: "Leaves", href: "/hr/leaves" },
        { id: "hr-payroll", label: "Payroll", href: "/hr/payroll" },
        { id: "hr-recruit", label: "Recruitment", href: "/hr/recruitment" },
      );
    } else if (pathname.startsWith("/finance")) {
      actions.push(
        { id: "fin-ledger", label: "Ledger", href: "/finance" },
        { id: "fin-approvals", label: "Approvals", href: "/finance?view=approvals" },
        { id: "fin-accounts", label: "Accounts", href: "/finance/accounts" },
        { id: "fin-reports", label: "Export", href: `${CANONICAL_DOMAIN_ROUTES.REPORTS}?scope=finance` },
      );
    }
    return actions;
  }, [pathname]);

  const mobilePrimaryRoute = useMemo(() => {
    if (layoutProfile.key === "HR") {
      return { href: "/hr", label: "People" };
    }
    if (layoutProfile.key === "FINANCER") {
      return { href: "/finance", label: "Finance" };
    }
    if (layoutProfile.key === "BDA_TRAINEE" || layoutProfile.key === "BDM_TRAINING") {
      return { href: CANONICAL_DOMAIN_ROUTES.TRAINING, label: "Training" };
    }
    return { href: CANONICAL_DOMAIN_ROUTES.CRM, label: "Leads" };
  }, [layoutProfile.key]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setProfileOpen(false);
      setNotificationsOpen(false);
      setSearchOpen(false);
      setSidebarOpen(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  useEffect(() => {
    if (!hasHydratedUiPrefs) return;
    try {
      window.localStorage.setItem("ui.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
    } catch {}
  }, [hasHydratedUiPrefs, sidebarCollapsed]);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const previousRoute = previousRouteKeyRef.current;
    if (previousRoute && previousRoute !== routeKey) {
      saveRouteScrollState(previousRoute, window.scrollY);
    }

    const history = readRouteHistory();
    if (history[history.length - 1] !== routeKey) {
      history.push(routeKey);
      if (history.length > ROUTE_HISTORY_LIMIT) {
        history.splice(0, history.length - ROUTE_HISTORY_LIMIT);
      }
      writeRouteHistory(history);
    }
    previousRouteKeyRef.current = routeKey;

    const previousInHistory = history.length > 1 ? history[history.length - 2] : null;
    setCanGoBack(history.length > 1);
    setRecentRoutes(
      [...history]
        .slice(0, -1)
        .reverse()
        .filter((entry, index, all) => all.indexOf(entry) === index)
        .slice(0, RECENT_ROUTES_LIMIT),
    );

    if (previousInHistory) {
      const routeStateMap = readRouteStateMap();
      setHasRestorableRouteState(Boolean(routeStateMap[previousInHistory]));
    } else {
      setHasRestorableRouteState(false);
    }

    const pendingRestoreTarget = getRouteRestoreTarget();
    if (pendingRestoreTarget && pendingRestoreTarget === routeKey) {
      setRouteRestoreTarget(null);
      const routeStateMap = readRouteStateMap();
      const snapshot = routeStateMap[routeKey];
      if (snapshot && Number.isFinite(snapshot.scrollY)) {
        window.setTimeout(() => {
          window.scrollTo({ top: Math.max(0, snapshot.scrollY), behavior: "auto" });
        }, 60);
      }
    }

    clearLocalSearchHighlights();
    setLocalSearchInput("");
    setLocalSearchNoMatch(false);
  }, [routeKey]);

  useEffect(
    () => () => {
      saveRouteScrollState(routeKey, window.scrollY);
    },
    [routeKey],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      applyLocalSearch(localSearchInput);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [localSearchInput, routeKey]);

  useEffect(() => {
    return () => {
      clearLocalSearchHighlights();
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    const delayedRefresh = window.setTimeout(() => refreshInPageSections(), 320);
    rafId = window.requestAnimationFrame(() => {
      refreshInPageSections();
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(delayedRefresh);
      if (inPageSectionRefreshTimerRef.current !== null) {
        window.clearTimeout(inPageSectionRefreshTimerRef.current);
        inPageSectionRefreshTimerRef.current = null;
      }
    };
  }, [routeKey]);

  useEffect(() => {
    const root = mainContentRef.current;
    if (!root) return;
    const observer = new MutationObserver(() => {
      scheduleInPageSectionRefresh();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [routeKey]);

  useEffect(() => {
    if (inPageSections.length === 0) {
      setActiveInPageSectionId(null);
      return;
    }
    const updateActiveSection = () => {
      let nextActive = inPageSections[0]?.id ?? null;
      for (const section of inPageSections) {
        const element = document.getElementById(section.id);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        if (top <= 168) nextActive = section.id;
      }
      if (
        window.innerHeight + window.scrollY >=
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - 8
      ) {
        nextActive = inPageSections[inPageSections.length - 1]?.id ?? nextActive;
      }
      setActiveInPageSectionId(nextActive);
    };
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [inPageSections]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusLocalSearch();
      }
      if (e.altKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        moveLocalSearch("prev");
      } else if (e.altKey && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        moveLocalSearch("next");
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [localSearchInput]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (profileOpen && profileMenuRef.current && target) {
        if (!profileMenuRef.current.contains(target)) setProfileOpen(false);
      }
      if (notificationsOpen && notificationsMenuRef.current && target) {
        if (!notificationsMenuRef.current.contains(target)) setNotificationsOpen(false);
      }
      if (searchOpen && searchRef.current && target) {
        if (!searchRef.current.contains(target)) setSearchOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [notificationsOpen, profileOpen, searchOpen]);

  async function onLogout() {
    await signOut();
    router.replace("/sign-in");
  }

  useEffect(() => {
    if (!searchOpen) {
      setSearchLoading(false);
      setSearchError(null);
      setPageResults([]);
      setLeadResults([]);
      setTaskResults([]);
      setEmployeeResults([]);
      return;
    }

    const term = searchInput.trim();
    if (term.length < 2) {
      setSearchLoading(false);
      setSearchError(null);
      setPageResults([]);
      setLeadResults([]);
      setTaskResults([]);
      setEmployeeResults([]);
      return;
    }

    const normalizedTerm = term.toLowerCase();
    const nextPageResults = commandPageCatalog
      .filter((entry) => {
        return [
          entry.label,
          entry.description ?? "",
          entry.href,
          ...(entry.keywords ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedTerm);
      })
      .slice(0, 8);

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPageResults(nextPageResults);
      if (!db || !userDoc) {
        setLeadResults([]);
        setTaskResults([]);
        setEmployeeResults([]);
        setSearchLoading(false);
        setSearchError(null);
        return;
      }

      setSearchLoading(true);
      setSearchError(null);

      try {
        const firestore = db;
        const [nextLeadResults, nextTaskResults] = await Promise.all([
          searchCrmLeads({
            firestore,
            term,
            allowedOwnerUids: searchScopeUids,
            limitPerQuery: 6,
            maxResults: 6,
          }),
          searchTasks(firestore, term, 6),
        ]);

        const nextEmployeeResults = searchableUsers
          .filter((candidate) => {
            return [
              candidate.displayName,
              candidate.name,
              candidate.email,
              candidate.employeeId,
            ]
              .filter(Boolean)
              .some((value) =>
                String(value).toLowerCase().includes(normalizedTerm),
              );
          })
          .slice(0, 6);

        if (cancelled) return;

        setLeadResults(nextLeadResults);
        setTaskResults(nextTaskResults);
        setEmployeeResults(nextEmployeeResults);
      } catch (error) {
        console.error("Global search failed", error);
        if (!cancelled) {
          setSearchError("Search failed. Try a different term.");
          setPageResults(nextPageResults);
          setLeadResults([]);
          setTaskResults([]);
          setEmployeeResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    commandPageCatalog,
    searchInput,
    searchOpen,
    searchScopeKey,
    searchableUsers,
    userDoc,
  ]);

  function resetSearch() {
    setSearchOpen(false);
    setSearchInput("");
    setSearchError(null);
    setPageResults([]);
    setLeadResults([]);
    setTaskResults([]);
    setEmployeeResults([]);
    setSearchLoading(false);
  }

  function openPageFromSearch(result: GlobalPageSearchResult) {
    resetSearch();
    router.push(result.href);
  }

  function openLeadFromSearch(lead: LeadDoc) {
    resetSearch();
    setSelectedSearchLead(lead);
  }

  function openTaskFromSearch(task: GlobalTaskSearchResult) {
    resetSearch();
    router.push(`/tasks?taskId=${task.id}`);
  }

  function openEmployeeFromSearch(employee: UserDoc) {
    resetSearch();
    router.push(employee.uid === userDoc?.uid ? "/profile/me" : `/profile/${employee.uid}`);
  }

  function clearLocalSearchHighlights() {
    const marks = localSearchMarksRef.current;
    if (marks.length === 0) return;

    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }

    localSearchMarksRef.current = [];
    localSearchActiveIndexRef.current = -1;
    setLocalSearchStats({ total: 0, active: 0 });
  }

  function setActiveLocalSearchIndex(nextIndex: number, shouldScroll = true) {
    const marks = localSearchMarksRef.current;
    if (marks.length === 0) {
      localSearchActiveIndexRef.current = -1;
      setLocalSearchStats({ total: 0, active: 0 });
      return;
    }

    const normalizedIndex = ((nextIndex % marks.length) + marks.length) % marks.length;
    marks.forEach((mark, index) => {
      mark.classList.toggle("local-search-hit-active", index === normalizedIndex);
    });

    localSearchActiveIndexRef.current = normalizedIndex;
    setLocalSearchStats({ total: marks.length, active: normalizedIndex + 1 });

    if (shouldScroll) {
      marks[normalizedIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  function applyLocalSearch(term: string) {
    if (typeof window === "undefined") return;

    const root = mainContentRef.current;
    clearLocalSearchHighlights();

    const normalizedTerm = term.trim();
    if (!root || normalizedTerm.length < LOCAL_SEARCH_MIN_LENGTH) {
      setLocalSearchNoMatch(false);
      return;
    }

    const regex = new RegExp(escapeRegExp(normalizedTerm), "gi");
    const excludedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "MARK"]);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (excludedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("[data-local-search-ignore='true']")) return NodeFilter.FILTER_REJECT;
          if (parent.closest("mark.local-search-hit")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }

    const marks: HTMLElement[] = [];
    for (const textNode of nodes) {
      const text = textNode.nodeValue ?? "";
      regex.lastIndex = 0;
      if (!regex.test(text)) continue;

      regex.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index)),
          );
        }
        const mark = document.createElement("mark");
        mark.className = "local-search-hit";
        mark.textContent = match[0];
        fragment.appendChild(mark);
        marks.push(mark);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    }

    localSearchMarksRef.current = marks;
    setLocalSearchNoMatch(marks.length === 0);
    if (marks.length > 0) {
      setActiveLocalSearchIndex(0, true);
    } else {
      setLocalSearchStats({ total: 0, active: 0 });
    }
  }

  function moveLocalSearch(direction: "next" | "prev") {
    const step = direction === "next" ? 1 : -1;
    if (localSearchMarksRef.current.length === 0) {
      applyLocalSearch(localSearchInput);
      return;
    }
    setActiveLocalSearchIndex(localSearchActiveIndexRef.current + step, true);
  }

  function focusLocalSearch() {
    localSearchInputRef.current?.focus();
    localSearchInputRef.current?.select();
  }

  function clearLocalSearch() {
    setLocalSearchInput("");
    setLocalSearchNoMatch(false);
    clearLocalSearchHighlights();
  }

  function handleBackNavigation() {
    const history = readRouteHistory();
    if (history.length > 1) {
      const nextHistory = [...history];
      nextHistory.pop();
      const target = nextHistory[nextHistory.length - 1];
      writeRouteHistory(nextHistory);
      if (target) {
        router.push(target);
        return;
      }
    }
    if (pathname !== homeRoute) {
      router.push(homeRoute);
    }
  }

  function handleRestorePreviousRouteState() {
    const history = readRouteHistory();
    if (history.length <= 1) return;
    const previous = history[history.length - 2];
    if (!previous) return;
    setRouteRestoreTarget(previous);
    router.push(previous);
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div
        className={classNames(
          "fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        className={classNames(
          "fixed left-0 top-0 z-50 flex h-full flex-col bg-white/60 backdrop-blur-2xl transition-all lg:translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)]",
          sidebarCollapsed ? "w-[76px]" : "w-64",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-3">
          <Link href={homeRoute} className="flex items-center gap-2">
            <div className="relative h-9 w-9 overflow-hidden rounded-lg">
              <Image 
                src={MainLogo} 
                alt="Logo" 
                fill 
                className="object-cover" 
                sizes="36px"
                priority
              />
            </div>
            {sidebarCollapsed ? null : (
              <div className="text-sm font-semibold tracking-tight">
                Edubh
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100/50 lg:inline-flex"
          >
            <span className="text-base leading-none">{sidebarCollapsed ? "»" : "«"}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400">
          <div className={classNames("px-3", sidebarCollapsed && "px-2")}>

          {sidebarCollapsed ? null : layoutProfile.showTeamModeToggle ? (
            <div className="mt-3">
              <div className="text-[11px] font-medium tracking-wide text-slate-500">Mode</div>
              <div className="mt-1">
                <div className="flex rounded-2xl bg-white/40 p-1 backdrop-blur-2xl shadow-sm">
                  {[
                    { label: "My Work", href: CANONICAL_DOMAIN_ROUTES.CRM },
                    { label: "Team Management", href: CANONICAL_DOMAIN_ROUTES.TEAM },
                  ].map((it) => {
                    const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        className={classNames(
                          "relative inline-flex h-8 flex-1 select-none items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-0",
                          active ? "text-white" : "text-slate-700 hover:bg-white/60",
                        )}
                        aria-pressed={active ? "true" : "false"}
                      >
                        {active && (
                          <motion.div
                            layoutId="mode-tab"
                            className="absolute inset-0 rounded-full bg-slate-900 shadow-sm"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                        <span className="relative z-10">{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {sidebarCollapsed ? null : (
          <div className="mt-2 px-3">
            {canSwitchWorkspace && (
              <div className="text-[11px] font-medium tracking-wide text-slate-500 mb-1">Workspace</div>
            )}
            <div className="relative">
              {pathname === homeRoute ? (
                <motion.div
                  layoutId="activeHomePill"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="absolute inset-0 rounded-xl bg-indigo-50 shadow-[0_0_24px_rgba(79,70,229,0.25)]"
                />
              ) : null}
              <Link
                href={homeRoute}
                className="relative flex min-h-[40px] select-none items-center gap-3 rounded-xl bg-white/40 px-3 py-2 text-[13px] font-medium text-slate-700 backdrop-blur-md transition hover:bg-white/60 focus:outline-none focus:ring-0"
                onClick={() => setSidebarOpen(false)}
              >
                <NavIcon name="home" className="h-5 w-5" />
                <span>My Day</span>
              </Link>
            </div>
          </div>
        )}

        {sidebarCollapsed ? null : (
          <div className="mt-3 px-3">
            <button
              type="button"
              onClick={() => setQuickAccessOpen((current) => !current)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 text-[11px] font-bold tracking-widest text-slate-500"
              aria-expanded={quickAccessOpen}
            >
              <span>QUICK ACCESS</span>
              <span className="text-xs font-semibold text-slate-600">{quickAccessOpen ? "Hide" : "Show"}</span>
            </button>

            {quickAccessOpen ? (
              <div className="mt-2 space-y-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/60 p-2">
                  <div className="px-2 py-1 text-[10px] font-bold tracking-widest text-slate-500">FAVORITES</div>
                  <div className="space-y-1">
                    {favoriteEntries.length === 0 ? (
                      <div className="px-2 py-2 text-xs text-slate-500">
                        Pin pages using the star in the menu.
                      </div>
                    ) : (
                      favoriteEntries.map((entry) => (
                        <div
                          key={`fav:${entry.href}`}
                          className="flex min-h-[34px] items-center justify-between rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Link
                            href={entry.href}
                            onClick={() => setSidebarOpen(false)}
                            className="min-w-0 flex-1 truncate"
                          >
                            {entry.label}
                          </Link>
                          <button
                            type="button"
                            onClick={() => togglePinnedRoute(entry.href)}
                            className="ml-2 inline-flex h-6 min-w-[42px] items-center justify-center rounded-md px-2 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"
                            aria-label={`Unpin ${entry.label}`}
                            title="Unpin"
                          >
                            Unpin
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/60 p-2">
                  <div className="px-2 py-1 text-[10px] font-bold tracking-widest text-slate-500">RECENT</div>
                  <div className="space-y-1">
                    {recentEntries.length === 0 ? (
                      <div className="px-2 py-2 text-xs text-slate-500">
                        Recently opened pages will appear here.
                      </div>
                    ) : (
                      recentEntries.map((entry) => (
                        <Link
                          key={`recent:${entry.href}`}
                          href={entry.href}
                          onClick={() => setSidebarOpen(false)}
                          className="flex min-h-[32px] items-center rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <span className="truncate">{entry.label}</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <nav className="mt-3 px-2">
          <motion.div
            key={workspace}
            variants={listVariants}
            initial="closed"
            animate="open"
            exit="closed"
            className="space-y-3"
          >
            {[...primaryGroups, ...(overflowGroup ? [overflowGroup] : [])].map((group) => (
              <div key={group.key} className="rounded-xl border border-white/20 bg-white/40 backdrop-blur-xl transition-colors">
                {sidebarCollapsed ? null : (
                  <button
                    type="button"
                    className="flex w-full select-none items-center justify-between px-3 py-3 text-[14px] font-semibold text-slate-900 focus:outline-none focus:ring-0"
                    onClick={() => toggleGroup(group.key)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleGroup(group.key);
                      }
                    }}
                  >
                    <span className="tracking-widest text-[11px] font-bold text-slate-500">{group.label}</span>
                    <motion.span
                      initial={false}
                      animate={{ rotate: group.open ? 90 : 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      className="inline-block h-4 w-4 text-slate-700"
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </motion.span>
                  </button>
                )}
                <AnimatePresence initial={false}>
                  <motion.div
                    variants={menuVariants}
                    initial={false}
                    animate={group.open ? "open" : "closed"}
                    className={classNames("px-2", sidebarCollapsed && "px-1")}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="space-y-1 pb-2 pt-2">
                      {group.children.map((child) => {
                        const isActive =
                          pathname === child.href || pathname.startsWith(`${child.href}/`);
                        const pinned = isPinnedRoute(child.href);
                        return (
                          <motion.div
                            key={child.href}
                            variants={itemVariants}
                            className="relative"
                            whileTap={sidebarCollapsed ? { scale: 0.95 } : undefined}
                          >
                            {isActive ? (
                              <motion.div
                                layoutId="activePill"
                                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                className={classNames(
                                  "absolute inset-0 rounded-lg",
                                  workspace === "HR"
                                    ? "bg-indigo-50 shadow-[0_0_24px_rgba(79,70,229,0.25)]"
                                    : "bg-emerald-50 shadow-[0_0_24px_rgba(5,150,105,0.25)]",
                                )}
                              />
                            ) : null}
                                                        <div
                              className={classNames(
                                "relative flex min-h-[40px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px]",
                                isActive
                                  ? "font-semibold text-slate-900"
                                  : "font-medium text-slate-500 hover:bg-white/60",
                              )}
                            >
                              <Link
                                href={child.href}
                                className="flex min-w-0 flex-1 items-center gap-3 focus:outline-none focus:ring-0"
                                onClick={() => setSidebarOpen(false)}
                                tabIndex={0}
                              >
                                <NavIcon name={child.icon} className="h-5 w-5" />
                                {sidebarCollapsed ? null : <span className="truncate">{child.label}</span>}
                              </Link>
                              {sidebarCollapsed ? null : (
                                <button
                                  type="button"
                                  onClick={() => togglePinnedRoute(child.href)}
                                  className={classNames(
                                    "inline-flex h-7 min-w-[42px] items-center justify-center rounded-md px-2 text-[10px] font-semibold",
                                    pinned
                                      ? "text-amber-700 hover:bg-amber-50"
                                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                                  )}
                                  title={pinned ? "Unpin page" : "Pin page"}
                                  aria-label={pinned ? "Unpin page" : "Pin page"}
                                >
                                  {pinned ? "Pinned" : "Pin"}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        </nav>
        </div>

        {layoutProfile.showSetup ? (
          <div className="shrink-0 px-3 pb-2">
            <Link
              href="/setup"
              className={classNames(
                "relative flex min-h-[40px] select-none items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition focus:outline-none focus:ring-0",
                pathname === "/setup"
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
              onClick={() => setSidebarOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
              {sidebarCollapsed ? null : <span>System Setup</span>}
            </Link>
          </div>
        ) : null}

        <div className="shrink-0 border-t border-slate-200/50 bg-white/40 p-3 backdrop-blur-sm">
          <div className={classNames("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-sm font-semibold">
                {(userDoc?.displayName ?? firebaseUser?.email ?? "U").trim().slice(0, 1).toUpperCase()}
              </div>
              {presenceQuery.data && presenceQuery.data.dateKey === todayKey && presenceQuery.data.status === "checked_in" ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" />
              ) : null}
            </div>
            {sidebarCollapsed ? null : (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {userDoc?.displayName ?? "User"}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {getDisplayRole(userDoc)}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                className={classNames(
                  "mt-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50",
                  sidebarCollapsed && "hidden",
                )}
                onClick={() => {
                  setSidebarOpen(false);
                  router.push("/profile/me");
                }}
              >
                Open Profile
              </button>
            </div>
          </aside>

      <div className={classNames("lg:pl-64", sidebarCollapsed && "lg:pl-[76px]")}>
        <header
          className={classNames(
            "sticky top-0 z-30 transition-colors",
            scrolled
              ? "border-b border-slate-200/50 bg-white/70 backdrop-blur-md"
              : "border-b border-transparent bg-transparent backdrop-blur-0",
          )}
        >
                    <div className="mx-auto flex min-h-[60px] max-w-7xl min-w-0 flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-700 hover:bg-slate-50 lg:hidden focus:outline-none focus:ring-0"
              >
                <MenuIcon />
              </button>

              <button
                type="button"
                onClick={handleBackNavigation}
                disabled={!canGoBack && pathname === homeRoute}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Back"
                data-local-search-ignore="true"
              >
                <span aria-hidden="true">&lt;</span>
                <span className="hidden sm:inline">Back</span>
              </button>

              <button
                type="button"
                onClick={handleRestorePreviousRouteState}
                disabled={!canGoBack || !hasRestorableRouteState}
                className="hidden h-9 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 md:inline-flex"
                title="Back to previous list state"
                data-local-search-ignore="true"
              >
                Restore list
              </button>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="hidden min-w-0 md:flex md:max-w-[260px] lg:max-w-[340px] items-center gap-2">
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  return (
                    <span key={`${crumb.href}:${index}`} className="inline-flex min-w-0 items-center gap-2">
                      {index > 0 ? <span className="text-slate-400">/</span> : null}
                      {isLast ? (
                        <span className="truncate text-xs font-semibold text-slate-700">{crumb.label}</span>
                      ) : (
                        <Link href={crumb.href} className="truncate text-xs font-medium text-slate-600 hover:underline">
                          {crumb.label}
                        </Link>
                      )}
                    </span>
                  );
                })}
              </div>
              {canSwitchWorkspace ? (
                <button
                  type="button"
                  onClick={() => setWorkspace(workspace === "HR" ? "CRM" : "HR")}
                  className="md:hidden inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100/80"
                >
                  {workspace}
                </button>
              ) : null}

              <div
                className={classNames(
                  "hidden h-9 min-w-0 items-center gap-1 rounded-lg border bg-white px-2 lg:flex",
                  localSearchNoMatch ? "border-rose-300 ring-1 ring-rose-200" : "border-slate-200",
                )}
                data-local-search-ignore="true"
              >
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Local
                </span>
                <input
                  ref={localSearchInputRef}
                  type="text"
                  value={localSearchInput}
                  onChange={(event) => setLocalSearchInput(event.target.value)}
                  placeholder="Find on page"
                  className="h-8 w-28 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400 xl:w-40"
                  aria-label="Find on current page"
                />
                <span className="hidden min-w-[54px] text-center text-[11px] text-slate-500 xl:inline">
                  {localSearchStats.total > 0
                    ? `${localSearchStats.active}/${localSearchStats.total}`
                    : localSearchInput.trim().length >= LOCAL_SEARCH_MIN_LENGTH
                      ? "0/0"
                      : "Find"}
                </span>
                <button
                  type="button"
                  onClick={() => moveLocalSearch("prev")}
                  className="hidden h-7 min-w-[42px] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 xl:inline-flex"
                  title="Previous match (Alt+Shift+Enter)"
                  aria-label="Previous match"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => moveLocalSearch("next")}
                  className="hidden h-7 min-w-[42px] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 xl:inline-flex"
                  title="Next match (Alt+Enter)"
                  aria-label="Next match"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={clearLocalSearch}
                  className="inline-flex h-7 min-w-[42px] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  title="Clear local search"
                  aria-label="Clear local search"
                >
                  Clear
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="group flex h-9 min-w-0 flex-1 items-center rounded-lg bg-white px-3 text-left text-sm text-slate-700 hover:bg-slate-100/80 sm:max-w-xs md:max-w-sm lg:max-w-md xl:max-w-lg focus:outline-none focus:ring-0"
                aria-label="Global search"
              >
                <span className="mr-2 inline-flex h-5 items-center justify-center rounded-md bg-slate-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">Global</span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-slate-500">Search pages, leads, tasks, reports</span>
                <span className="ml-2 hidden shrink-0 rounded-md bg-white px-1.5 text-[11px] text-slate-600 xl:inline-block">Ctrl/Cmd+K</span>
              </button>
            </div>

            <div className="relative" ref={notificationsMenuRef}>
              <button
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <BellIcon />
                {unreadNotificationsCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                ) : null}
              </button>
              {notificationsOpen ? (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="text-sm font-semibold">Notifications</div>
                    {unreadNotificationsCount > 0 ? (
                      <div className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {unreadNotificationsCount}
                      </div>
                    ) : null}
                  </div>
                  <div className="max-h-[400px] overflow-y-auto border-t border-slate-200">
                    {notifications.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-slate-600">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="border-b border-slate-100 bg-white px-3 py-3 last:border-0 hover:bg-slate-50">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-slate-900">{n.title}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{n.body}</div>
                              {n.priority && (
                                <span className={`mt-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  n.priority === 'high' ? 'bg-rose-100 text-rose-700' : 
                                  n.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 
                                  'bg-blue-100 text-blue-700'
                                }`}>
                                  {n.priority.charAt(0).toUpperCase() + n.priority.slice(1)} Priority
                                </span>
                              )}
                            </div>
                            {!n.read && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(n.id);
                                }} 
                                className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" 
                                title="Mark as read" 
                              />
                            )}
                          </div>
                          {n.relatedTaskId && (
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => handleNotificationAction(n, 'view')}
                                className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                              >
                                View Details
                              </button>
                              <button
                                onClick={() => handleNotificationAction(n, 'accept')}
                                className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                              >
                                Accept
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100/80"
              >
                <span className="hidden max-w-[140px] truncate sm:inline">{userDoc?.displayName ?? firebaseUser?.email ?? "Profile"}</span>
                <span className="inline sm:hidden">Profile</span>
                <span className="text-slate-500">▾</span>
              </button>

              {profileOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                >
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-semibold">{userDoc?.displayName ?? "User"}</div>
                    <div className="mt-1 inline-flex items-center gap-2">
                      <div className="truncate text-xs text-slate-500">{firebaseUser?.email ?? "--"}</div>
                      {userDoc ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          {getDisplayRole(userDoc)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="border-t border-slate-200">
                    <Link
                      href="/profile/me"
                      className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setProfileOpen(false)}
                    >
                      Profile
                    </Link>
                    <Link
                      href="/attendance"
                      className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setProfileOpen(false)}
                    >
                      Attendance History
                    </Link>
                    <button
                      type="button"
                      onClick={() => void onLogout()}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Sign Out
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </div>
          </div>

          {inPageSections.length > 0 ? (
            <div
              className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 pb-2 pt-1 sm:px-6"
              data-local-search-ignore="true"
            >
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                On page
              </span>
              {inPageSections.map((section) => {
                const isActive = activeInPageSectionId === section.id;
                return (
                  <button
                    key={`in-page-${section.id}`}
                    type="button"
                    onClick={() => jumpToInPageSection(section.id)}
                    className={classNames(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
                      isActive
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-50",
                    )}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>

        {searchOpen ? (
          <div className="fixed inset-0 z-[60]">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-2xl" />
            <div className="relative mx-auto mt-20 max-w-2xl px-4 sm:px-6" ref={searchRef}>
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-xl backdrop-blur-md"
              >
                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                  <span className="inline-flex h-6 items-center justify-center rounded-md bg-slate-100 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-700">Global</span>
                  <input
                    autoFocus
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Jump to pages, leads, tasks, reports..."
                    className="h-9 w-full bg-transparent text-sm outline-none"
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100/80"
                    onClick={resetSearch}
                  >
                    Close
                  </button>
                </div>
                <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
                  {searchInput.trim().length < 2 ? (
                    <div className="text-sm text-slate-600">
                      Type at least 2 characters to search pages, leads, tasks, and employees.
                    </div>
                  ) : searchError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {searchError}
                    </div>
                  ) : pageResults.length === 0 && leadResults.length === 0 && taskResults.length === 0 && employeeResults.length === 0 && !searchLoading ? (
                    <div className="text-sm text-slate-600">No results found.</div>
                  ) : (
                    <div className="space-y-5">
                      {searchLoading ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                          Searching CRM objects...
                        </div>
                      ) : null}
                      {pageResults.length > 0 ? (
                        <section>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pages</div>
                          <div className="space-y-2">
                            {pageResults.map((result) => (
                              <button
                                key={result.id}
                                type="button"
                                onClick={() => openPageFromSearch(result)}
                                className="flex w-full items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{result.label}</div>
                                  {result.description ? (
                                    <div className="mt-1 truncate text-xs text-slate-500">{result.description}</div>
                                  ) : null}
                                </div>
                                <div className="ml-4 text-xs text-slate-400">{normalizeRoutePath(result.href)}</div>
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {leadResults.length > 0 ? (
                        <section>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Leads</div>
                          <div className="space-y-2">
                            {leadResults.map((lead) => (
                              <button
                                key={lead.leadId}
                                type="button"
                                onClick={() => openLeadFromSearch(lead)}
                                className="flex w-full items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{lead.name}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{getLeadStatusLabel(lead.status)}</span>
                                    <span>{lead.phone ?? "No phone"}</span>
                                    <span>{lead.email ?? "No email"}</span>
                                    {lead.source ? <span>Source: {lead.source}</span> : null}
                                    {lead.importBatchId ? <span>Batch: {lead.importBatchId.slice(-6)}</span> : null}
                                    {(lead.leadTags ?? []).slice(0, 2).map((tag, index) => (
                                      <span key={`${lead.leadId}-search-tag-${tag}-${index}`}>Tag: {tag}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="ml-4 text-xs font-mono text-slate-400">{lead.leadId}</div>
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {taskResults.length > 0 ? (
                        <section>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Tasks</div>
                          <div className="space-y-2">
                            {taskResults.map((task) => (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => openTaskFromSearch(task)}
                                className="flex w-full items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{task.title || "Untitled task"}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{task.status || "pending"}</span>
                                    {task.leadName ? <span>{task.leadName}</span> : null}
                                    {task.leadId ? <span>{task.leadId}</span> : null}
                                  </div>
                                </div>
                                <div className="ml-4 text-xs text-slate-400">{task.priority || "normal"}</div>
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {employeeResults.length > 0 ? (
                        <section>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Employees</div>
                          <div className="space-y-2">
                            {employeeResults.map((employee) => (
                              <button
                                key={employee.uid}
                                type="button"
                                onClick={() => openEmployeeFromSearch(employee)}
                                className="flex w-full items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{employee.displayName || employee.name || employee.email || employee.uid}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{employee.email || "No email"}</span>
                                    {employee.employeeId ? <span>{employee.employeeId}</span> : null}
                                  </div>
                                </div>
                                <div className="ml-4 text-xs text-slate-400">{getDisplayRole(employee)}</div>
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        ) : null}

        {stickyContextActions.length > 0 ? (
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-20 hidden w-full max-w-4xl -translate-x-1/2 px-4 md:block">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-md">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                Context Actions
              </span>
              {stickyContextActions.map((action) =>
                action.href ? (
                  <Link
                    key={action.id}
                    href={action.href}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {action.label}
                  </Link>
                ) : (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.onClick}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}

        <main
          ref={mainContentRef}
          className="mx-auto max-w-7xl min-w-0 overflow-x-clip px-4 py-6 pb-28 sm:px-6 sm:pb-28 md:pb-24 lg:pb-24 [&>*]:min-w-0"
        >
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
            <Link
              href={homeRoute}
              className={classNames(
                "inline-flex items-center justify-center rounded-lg px-2 py-2 text-xs font-semibold",
                pathname === homeRoute ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
              )}
            >
              Home
            </Link>
            <Link
              href={mobilePrimaryRoute.href}
              className={classNames(
                "inline-flex items-center justify-center rounded-lg px-2 py-2 text-xs font-semibold",
                pathname === mobilePrimaryRoute.href || pathname.startsWith(`${mobilePrimaryRoute.href}/`)
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700",
              )}
            >
              {mobilePrimaryRoute.label}
            </Link>
            <Link
              href="/tasks"
              className={classNames(
                "inline-flex items-center justify-center rounded-lg px-2 py-2 text-xs font-semibold",
                pathname === "/tasks" || pathname.startsWith("/tasks/")
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700",
              )}
            >
              Tasks
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700"
            >
              Search
            </button>
          </div>
        </nav>

        {userDoc ? (
          <LeadDetailPanel
            isOpen={selectedSearchLead !== null}
            onClose={() => setSelectedSearchLead(null)}
            lead={selectedSearchLead}
            currentUser={userDoc}
          />
        ) : null}
      </div>
    </div>
  );
}

