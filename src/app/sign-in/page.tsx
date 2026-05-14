"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth } from "@/lib/firebase/client";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import { getHomeRoute } from "@/lib/utils/routing";
import { getRedirectResult } from "firebase/auth";

function isFirebaseAuthError(
  err: unknown,
): err is { code?: string; message?: string } {
  return typeof err === "object" && err !== null;
}

function getFriendlyAuthError(err: unknown) {
  if (!isFirebaseAuthError(err)) return "Auth error";
  if (err.code === "auth/network-request-failed") {
    return "Network issue while signing in. Please check your connection and try again.";
  }
  if (err.code === "auth/configuration-not-found") {
    return "Firebase Authentication is not enabled for this project. Enable Email/Password in Firebase Authentication.";
  }
  if (err.code === "auth/invalid-api-key") {
    return "Firebase API key is invalid. Check your `.env.local` values and restart the dev server.";
  }
  if (err.code === "auth/account-exists-with-different-credential") {
    return "This account is registered with email/password. Please login using email and password.";
  }
  return err.message ?? "Auth error";
}

function SignInContent() {
  const {
    firebaseUser,
    userDoc,
    isFirebaseReady,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInWithGoogle,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fallbackPath = useMemo(
    () => getHomeRoute(userDoc?.role, userDoc?.orgRole) || CANONICAL_DOMAIN_ROUTES.CRM,
    [userDoc],
  );
  const nextPath = useMemo(
    () => searchParams.get("redirect") || searchParams.get("next") || fallbackPath,
    [fallbackPath, searchParams],
  );
  const explicitNextPath = useMemo(
    () => searchParams.get("redirect") || searchParams.get("next"),
    [searchParams],
  );
  const expired = useMemo(() => searchParams.get("expired") === "1", [searchParams]);

  const [mode] = useState<"signIn" | "signUp">("signIn");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [checkedRedirect, setCheckedRedirect] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;

    if (explicitNextPath) {
      router.replace(explicitNextPath);
      return;
    }

    if (userDoc && nextPath) {
      router.replace(nextPath);
    }
  }, [explicitNextPath, firebaseUser, nextPath, router, userDoc]);

  useEffect(() => {
    async function checkRedirect() {
      if (!auth || checkedRedirect) return;
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          setIsRedirecting(true);
        }
      } catch {
        // ignore redirect fallback errors
      }
      setCheckedRedirect(true);
    }

    void checkRedirect();
  }, [checkedRedirect]);

  async function handleGoogleLogin() {
    setError(null);
    setIsGoogleSubmitting(true);

    try {
      if (!auth) throw new Error("Firebase is not configured");
      await signInWithGoogle();
      setIsRedirecting(true);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "auth/popup-closed-by-user") {
        console.error("Google Sign-In Error:", err);
        setError(getFriendlyAuthError(err));
      }
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === "signIn") {
        await signInWithEmailPassword(email, password);
      } else {
        await signUpWithEmailPassword(email, password, displayName);
      }

      setIsRedirecting(true);
    } catch (err) {
      setError(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
        <div className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <button
              onClick={() => router.push("/")}
              className="group flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-800"
            >
              <ChevronLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              Back to Home
            </button>
          </div>

          {expired ? (
            <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <span className="inline-block h-2 w-2 rounded-full bg-indigo-600" />
              Session expired. Please sign in to continue.
            </div>
          ) : null}

          <div className="flex items-center">
            <h1 className="text-lg font-semibold tracking-tight">
              {mode === "signIn" ? "Sign in" : "Create an account"}
            </h1>
          </div>

          <p className="mt-1 text-sm text-slate-600">
            {mode === "signIn"
              ? "Sign in with Google or Email/Password."
              : "Enter your details to get started."}
          </p>

          {!isFirebaseReady ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Firebase env vars are missing. Add your `NEXT_PUBLIC_FIREBASE_*`
              values to `.env.local`.
            </div>
          ) : null}

          <button
            type="button"
            disabled={isSubmitting || isGoogleSubmitting || isRedirecting || !isFirebaseReady}
            onClick={() => void handleGoogleLogin()}
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGoogleSubmitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Validating Google...
              </>
            ) : (
              "Continue with Google"
            )}
          </button>

          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <div className="text-xs font-medium text-slate-500">or</div>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "signUp" ? (
              <label className="block">
                <div className="text-xs font-medium text-slate-600">Full name</div>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <div className="text-xs font-medium text-slate-600">Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                required
              />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-medium text-slate-600">
                  Password
                </label>
                {mode === "signIn" ? (
                  <div className="text-xs">
                    <button
                      type="button"
                      onClick={() => setShowForgotModal(true)}
                      className="font-medium text-indigo-600 transition-colors hover:text-indigo-500"
                    >
                      Forgot password?
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="relative mt-1 rounded-md">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                  required
                  className="block w-full rounded-md border border-slate-200 bg-white py-2 pl-3 pr-10 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 z-10 flex h-full cursor-pointer items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <EyeIcon className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting || isGoogleSubmitting || isRedirecting || !isFirebaseReady}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {isRedirecting
                ? "Redirecting..."
                : isSubmitting
                  ? "Please wait..."
                  : mode === "signIn"
                    ? "Sign in"
                    : "Create account"}
            </button>
          </form>
        </div>
      </div>

      <ForgotPasswordModal
        isOpen={showForgotModal}
        onClose={() => setShowForgotModal(false)}
        initialEmail={email}
      />
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <SignInContent />
    </Suspense>
  );
}
