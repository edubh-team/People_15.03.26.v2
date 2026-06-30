"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getHomeRoute } from "@/lib/utils/routing";

export default function UnauthorizedPage() {
  const { signOut, userDoc, isLoading } = useAuth();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);

  function handleDashboardRedirect() {
    setIsRedirecting(true);
    
    // Safety check: if we somehow don't have a user, go to sign-in
    if (!userDoc && !isLoading) {
      router.push("/sign-in");
      return;
    }

    // Dynamic Role-Based Routing
    // This uses the centralized routing logic to ensure consistency
    const target = getHomeRoute(userDoc?.role, userDoc?.orgRole);
    router.push(target);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
        <div className="w-full rounded-[24px] border border-white/10 bg-white/5 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="text-xs font-semibold tracking-wide text-white/60">
            Security
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Access Denied
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/70">
            You do not have the required permissions to view this secure module. This attempt has been logged.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() =>
                void signOut().finally(() => router.replace("/sign-in"))
              }
              className="inline-flex h-11 items-center justify-center rounded-[18px] bg-white px-5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-white/95"
            >
              Sign out
            </button>
            <button
              type="button"
              onClick={handleDashboardRedirect}
              disabled={isLoading || isRedirecting}
              className="inline-flex h-11 items-center justify-center rounded-[18px] border border-white/10 bg-white/0 px-5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(isLoading || isRedirecting) ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Redirecting...
                </span>
              ) : (
                "Return to Dashboard"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
