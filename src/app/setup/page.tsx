"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { motion } from "framer-motion";

export default function SetupPage() {
  const { firebaseUser, isLoading } = useAuth();
  const router = useRouter();
  
  const [email, setEmail] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  // Case A: Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !firebaseUser) {
      router.replace("/sign-in?redirect=/setup");
    }
  }, [isLoading, firebaseUser, router]);

  // Pre-fill email if logged in
  useEffect(() => {
    if (firebaseUser?.email) {
      setEmail(firebaseUser.email);
    }
  }, [firebaseUser]);

  const handlePromote = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      // 1. Optional client-side pre-check when a public setup key is intentionally exposed.
      const envKey = process.env.NEXT_PUBLIC_SETUP_KEY;
      
      if (envKey && secretKey !== envKey) {
        throw new Error("Invalid Master Secret Key.");
      }

      // 2. Call Secure API Endpoint
      const response = await fetch("/api/setup/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          secretKey,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Promotion failed.");
      }

      // 3. Force token refresh if promoting self
      if (firebaseUser?.email === email) {
        await firebaseUser.getIdToken(true);
      }

      setStatus("success");
      setMessage(data.message || `Success! ${email} is now a Super Admin.`);
      
    } catch (err: unknown) {
      console.error("Promotion failed:", err);
      setStatus("error");
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
      setMessage(errorMessage);
    }
  };

  if (isLoading) {
    return null; // Or a subtle spinner
  }

  if (!firebaseUser) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-[0_20px_40px_rgba(0,0,0,0.04)]"
      >
        <div className="relative border-b border-slate-50 p-8 text-center">
          <button
            type="button"
            onClick={() => router.back()}
            className="absolute left-6 top-6 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Go back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-900">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Admin Bootstrap
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Escalate privileges to Super Admin. This action is logged and requires a master key.
            Server-only bootstrap secrets are supported.
          </p>
        </div>

        <form onSubmit={handlePromote} className="p-8">
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-700">
                Target User Email
              </label>
              <input
                type="email"
                id="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500"
                placeholder="user@example.com"
              />
            </div>

            <div>
              <label htmlFor="secret" className="block text-xs font-medium text-slate-700">
                Master Secret Key
              </label>
              <input
                type="password"
                id="secret"
                required
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="mt-1 block w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500"
                placeholder="••••••••••••••••"
              />
            </div>
          </div>

          {message && (
            <div className={`mt-6 rounded-lg p-3 text-xs font-medium ${
              status === "success" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
            }`}>
              {message}
            </div>
          )}

          <div className="mt-8">
            <button
              type="submit"
              disabled={status === "loading"}
              className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {status === "loading" ? "Verifying..." : "Promote to Super Admin"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
