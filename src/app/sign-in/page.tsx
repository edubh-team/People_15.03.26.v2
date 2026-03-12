"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth, db } from "@/lib/firebase/client";
import { getRedirectResult, GoogleAuthProvider, linkWithCredential, AuthCredential } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { doc, getDoc } from "firebase/firestore";
import { getHomeRoute } from "@/lib/utils/routing";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";
import { ChevronLeftIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";

function isFirebaseAuthError(
  err: unknown,
): err is { code?: string; message?: string } {
  return typeof err === "object" && err !== null;
}

function getFriendlyAuthError(err: unknown) {
  if (!isFirebaseAuthError(err)) return "Auth error";
  if (err.code === "auth/configuration-not-found") {
    return "Firebase Authentication is not enabled for this project. In Firebase Console: Authentication → Get started → Sign-in method → enable Email/Password.";
  }
  if (err.code === "auth/invalid-api-key") {
    return "Firebase API key is invalid. Check your `.env.local` values and restart the dev server.";
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
  const expired = useMemo(() => searchParams.get("expired") === "1", [searchParams]);

  const [mode] = useState<"signIn" | "signUp">("signIn");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [checkedRedirect, setCheckedRedirect] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [pendingCredential, setPendingCredential] = useState<AuthCredential | null>(null);

  useEffect(() => {
    if (firebaseUser && nextPath) router.replace(nextPath);
  }, [firebaseUser, nextPath, router]);

  useEffect(() => {
    async function checkRedirect() {
      if (!auth || !db || checkedRedirect) return;
      try {
        const res = await getRedirectResult(auth);
        if (res?.user) {
          if (!db) throw new Error("Firebase Firestore is not configured");
          const ref = doc(db, "users", res.user.uid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data() as { role?: string | null; orgRole?: string | null };
            const target = getHomeRoute(data.role, data.orgRole);
            router.replace(target);
            setIsRedirecting(true);
          } else {
            setError("No account profile found. Please contact Admin.");
          }
        }
      } catch {}
      setCheckedRedirect(true);
    }
    void checkRedirect();
  }, [checkedRedirect, router]);

  async function handleGoogleLogin() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (!auth || !db) throw new Error("Firebase is not configured");
      
      // Use Popup flow via useAuth for better compatibility
      await signInWithGoogle();
      
      // Handle post-login redirection logic (same as onSubmit)
      const uid = auth.currentUser?.uid ?? null;
      if (uid) {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as { role?: string | null; orgRole?: string | null };
          const target = getHomeRoute(data.role, data.orgRole);
          router.replace(target);
          setIsRedirecting(true);
        } else {
           // Default fallback if user doc missing (should be handled by AuthProvider ensureUserDoc but just in case)
           setIsRedirecting(true);
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/account-exists-with-different-credential") {
        const credential = GoogleAuthProvider.credentialFromError(err as FirebaseError);
        const emailFromError = (err as { customData?: { email?: string } }).customData?.email;
        if (credential && emailFromError) {
          setPendingCredential(credential);
          setEmail(emailFromError);
          setError("An account with this email already exists. Please enter your password to verify and link your Google account.");
        } else {
          setError("An account with this email already exists. Please log in with your password.");
        }
      } else if (code !== "auth/popup-closed-by-user") {
        console.error("Google Sign-In Error:", err);
        setError("Google Sign-In failed. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "signIn") {
        await signInWithEmailPassword(email, password);
        // If we have a pending credential (e.g. from a failed Google sign-in due to existing account), link it now
        if (pendingCredential && auth?.currentUser) {
          try {
             await linkWithCredential(auth.currentUser, pendingCredential);
             setPendingCredential(null);
             // Optional: notify user linked successfully
          } catch (linkErr) {
             console.error("Failed to link credential:", linkErr);
             // We don't block login if linking fails, but maybe warn?
             // Proceeding to redirect anyway.
          }
        }
      } else {
        await signUpWithEmailPassword(email, password, displayName);
      }
      const uid = auth?.currentUser?.uid ?? null;
      if (uid && db) {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as { role?: string | null; orgRole?: string | null };
          const target = getHomeRoute(data.role, data.orgRole);
          router.replace(target);
          setIsRedirecting(true);
        } else {
          setIsRedirecting(true);
        }
      } else {
        setIsRedirecting(true);
      }
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
              className="group flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
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
            disabled={isSubmitting || isRedirecting || !isFirebaseReady}
            onClick={() => void handleGoogleLogin()}
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            Continue with Google
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
                {mode === "signIn" && (
                  <div className="text-xs">
                    <button
                      type="button"
                      onClick={() => setShowForgotModal(true)}
                      className="font-medium text-indigo-600 hover:text-indigo-500 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
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
                  className="absolute inset-y-0 right-0 z-10 flex h-full items-center pr-3 cursor-pointer text-slate-400 hover:text-slate-600 focus:outline-none"
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
              disabled={isSubmitting || isRedirecting || !isFirebaseReady}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {isRedirecting
                ? "Redirecting…"
                : isSubmitting
                  ? "Please wait…"
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
