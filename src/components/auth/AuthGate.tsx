"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isSuperAdminUser, normalizeRoleValue } from "@/lib/access";
import type { UserRole, OrgUserRole } from "@/lib/types/user";
import { getHomeRoute } from "@/lib/utils/routing";
import { useAuth } from "./AuthProvider";
import { motion } from "framer-motion";
import { canUserOperate } from "@/lib/people/lifecycle";

type Props = {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  allowedOrgRoles?: OrgUserRole[];
  deniedRoles?: UserRole[];
  deniedOrgRoles?: OrgUserRole[];
  /**
   * Optional custom check function. If provided and returns true, access is granted
   * regardless of role checks (except denied roles).
   */
  allowIf?: (user: import("@/lib/types/user").UserDoc) => boolean;
};

export function AuthGate({ children, allowedRoles, allowedOrgRoles, deniedRoles, deniedOrgRoles, allowIf }: Props) {
  const { firebaseUser, userDoc, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [minWaitDone, setMinWaitDone] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (minWaitDone) return;
    timerRef.current = window.setTimeout(() => setMinWaitDone(true), 300);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [minWaitDone]);

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      return;
    }

    // Onboarding Gate
    if (userDoc) {
      if (!canUserOperate(userDoc)) {
        router.replace("/unauthorized");
        return;
      }
      const isAdmin = userDoc.role === "admin" || userDoc.orgRole === "SUPER_ADMIN";
      const isOnboardingPage = pathname === "/onboarding";
      
      // If not admin, not onboarded, and not on onboarding page -> Redirect to onboarding
      if (!isAdmin && !userDoc.onboardingCompleted && !isOnboardingPage) {
         router.replace("/onboarding");
      }
    }
    // We don't redirect here for role mismatch anymore, we show the modal.
  }, [firebaseUser, isLoading, pathname, router, userDoc]);

  if (isLoading || !minWaitDone) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6">
          <div className="flex items-center gap-2 rounded-2xl bg-white/60 px-4 py-2 text-sm text-slate-700 backdrop-blur-md">
            <span className="inline-flex h-5 w-5 animate-spin items-center justify-center rounded-full border-2 border-slate-300 border-t-slate-700" />
            <span>Verifying Security…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!firebaseUser) return null; // Will redirect in useEffect

  const normalizedRole = normalizeRoleValue(userDoc?.role);
  const normalizedOrgRole = normalizeRoleValue(userDoc?.orgRole);
  const allowedRoleSet = new Set((allowedRoles ?? []).map((role) => normalizeRoleValue(role)));
  const allowedOrgRoleSet = new Set(
    (allowedOrgRoles ?? []).map((role) => normalizeRoleValue(role)),
  );
  const deniedRoleSet = new Set((deniedRoles ?? []).map((role) => normalizeRoleValue(role)));
  const deniedOrgRoleSet = new Set(
    (deniedOrgRoles ?? []).map((role) => normalizeRoleValue(role)),
  );

  const roleOk = !allowedRoles || allowedRoleSet.has(normalizedRole);
  const orgRoleOk = !allowedOrgRoles || allowedOrgRoleSet.has(normalizedOrgRole);

  const roleDenied = deniedRoles ? deniedRoleSet.has(normalizedRole) : false;
  const orgRoleDenied = deniedOrgRoles ? deniedOrgRoleSet.has(normalizedOrgRole) : false;

  const customAllowed = allowIf && userDoc && allowIf(userDoc);
  const hasAccess =
    isSuperAdminUser(userDoc) ||
    customAllowed ||
    ((roleOk && orgRoleOk) && !roleDenied && !orgRoleDenied);

  if (!hasAccess) {
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-xl p-4">
              <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="max-w-md w-full bg-white/70 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-3xl p-8 text-center"
              >
                  <div className="mb-6 flex justify-center">
                      <div className="h-16 w-16 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                      </div>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
                  <p className="text-slate-600 mb-8 leading-relaxed">
                      You do not have the required permissions to view this secure module. This attempt has been logged.
                  </p>
                  <button 
                      onClick={() => router.push(getHomeRoute(userDoc?.role, userDoc?.orgRole))}
                      className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"
                  >
                      Return to Dashboard
                  </button>
              </motion.div>
          </div>
      );
  }

  return <>{children}</>;
}
