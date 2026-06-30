"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import OnboardingKYCForm from "@/components/onboarding/OnboardingKYCForm";
import { getHomeRoute } from "@/lib/utils/routing";

export default function OnboardingPage() {
  const { userDoc, isLoading, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace("/sign-in");
      return;
    }
    
    // If already onboarded, kick out
    if (userDoc?.onboardingCompleted) {
      router.replace(getHomeRoute(userDoc.role, userDoc.orgRole));
    }
  }, [isLoading, firebaseUser, userDoc, router]);

  if (isLoading || !userDoc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Employee Onboarding
        </h1>
        <p className="mt-2 text-base text-slate-600">
          Complete your KYC to activate your account.
        </p>
      </div>
      <OnboardingKYCForm currentUser={userDoc} />
    </div>
  );
}
