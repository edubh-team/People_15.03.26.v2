"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { auth, isFirebaseReady } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";
import { ensureUserDoc, getUserDoc, upsertUserDoc } from "@/lib/firebase/users";
import { logLoginEvent } from "@/lib/firebase/authLogs";
import { checkOut } from "@/lib/firebase/attendance";
import { KeyPairManager } from "@/lib/encryption/KeyPairManager";
import { canUserOperate } from "@/lib/people/lifecycle";

type AuthState = {
  firebaseUser: User | null;
  userDoc: UserDoc | null;
  isLoading: boolean;
  isFirebaseReady: boolean;
  isAuthorized: boolean;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmailPassword: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUserDoc: () => Promise<void>;
  updateMyProfile: (input: {
    displayName?: string;
    phone?: string;
  }) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const a = auth;
    if (!a) {
      setIsLoading(false);
      return;
    }

    return onAuthStateChanged(a, async (u) => {
      setFirebaseUser(u);
      if (!u) {
        setUserDoc(null);
        setIsLoading(false);
        try {
          await fetch("/api/session/clear", { method: "POST" });
        } catch {}
        return;
      }

      setIsLoading(true);
      try {
        const isGoogle = u.providerData.some((p) => p.providerId === "google.com");
        const ensured = await ensureUserDoc(u, {
          requireEmployeeAccess: isGoogle,
        });
        setUserDoc(ensured);
        const provider = u.providerData[0]?.providerId ?? "unknown";
        try {
          await logLoginEvent({ uid: u.uid, email: u.email ?? null, provider });
        } catch {
          // ignore logging failures
        }
        try {
          const token = await u.getIdToken();
          await fetch("/api/session/set", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        } catch {
          // ignore cookie set failures
        }
      } catch (err) {
        setUserDoc(null);
        try {
          await signOut(a);
        } finally {
          const message = err instanceof Error ? err.message : "Unauthorized";
          if (message.toLowerCase().includes("unauthorized")) {
            window.location.replace("/unauthorized");
          }
        }
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser || !userDoc) return;

    let active = true;
    (async () => {
      try {
        // Keep messaging identity ready for all users, not only when /chat is opened.
        await KeyPairManager.getInstance().ensureKeyPairExists(firebaseUser.uid);
      } catch (error) {
        if (!active) return;
        console.error("Failed to initialize secure messaging identity.", error);
      }
    })();

    return () => {
      active = false;
    };
  }, [firebaseUser, userDoc]);

  const value = useMemo<AuthState>(
    () => ({
      firebaseUser,
      userDoc,
      isLoading,
      isFirebaseReady,
      isAuthorized:
        Boolean(userDoc && canUserOperate(userDoc)),
      async signInWithEmailPassword(email: string, password: string) {
        if (!auth) throw new Error("Firebase is not configured");
        // 1. Enforce Tab Isolation
        // This ensures the auth state is stored in Session Storage (unique to this tab)
        // rather than Local Storage (shared across all tabs).
        // UX Warning: If the user closes the tab and reopens it, they will be logged out.
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signInWithGoogle() {
        if (!auth) throw new Error("Firebase is not configured");
        // Enforce Tab Isolation for Google Sign-In as well
        await setPersistence(auth, browserSessionPersistence);
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(auth, provider);
      },
      async signUpWithEmailPassword(
        email: string,
        password: string,
        displayName?: string,
      ) {
        if (!auth) throw new Error("Firebase is not configured");
        // Enforce Tab Isolation for Sign-Up as well
        await setPersistence(auth, browserSessionPersistence);
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (cred.user && cred.user.displayName == null && displayName) {
          await updateProfile(cred.user, { displayName });
        }
        if (cred.user) {
          await upsertUserDoc(cred.user.uid, {
            displayName: displayName?.trim() ? displayName.trim() : null,
            email: cred.user.email ?? null,
            phone: cred.user.phoneNumber ?? null,
          });
          const ensured = await ensureUserDoc(cred.user);
          setUserDoc(ensured);
        }
      },
      async signOut() {
        if (!auth) return;
        try {
          if (firebaseUser?.uid) {
            await checkOut(firebaseUser.uid);
          }
        } catch {
          // ignore presence errors
        } finally {
          try {
            await fetch("/api/session/clear", { method: "POST" });
          } catch {}
          try {
            window.localStorage.removeItem("ui.workspace");
            window.localStorage.removeItem("ui.sidebarCollapsed");
          } catch {}
          await signOut(auth);
        }
      },
      async refreshUserDoc() {
        if (!firebaseUser) return;
        if (!auth) return;
        const next = await getUserDoc(firebaseUser.uid);
        setUserDoc(next);
      },
      async updateMyProfile(input: { displayName?: string; phone?: string }) {
        if (!auth) throw new Error("Firebase is not configured");
        if (!firebaseUser) throw new Error("Not signed in");

        if (typeof input.displayName !== "undefined") {
          await updateProfile(firebaseUser, { displayName: input.displayName });
        }

        await upsertUserDoc(firebaseUser.uid, {
          ...(typeof input.displayName !== "undefined"
            ? { displayName: input.displayName || null }
            : {}),
          ...(typeof input.phone !== "undefined"
            ? { phone: input.phone || null }
            : {}),
        });

        const next = await getUserDoc(firebaseUser.uid);
        setUserDoc(next);
      },
    }),
    [firebaseUser, userDoc, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
