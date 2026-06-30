"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { RoleBadge } from "@/components/RoleBadge";
import { formatDateToYYYYMMDD, isBirthdayToday } from "@/lib/birthdays";

export default function ProfilePage() {
  const { userDoc, firebaseUser, updateMyProfile, signOut } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(userDoc?.displayName ?? "");
  const [phone, setPhone] = useState(userDoc?.phone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || "People CRM";
  const showBirthdayGreeting = isBirthdayToday(userDoc);

  useEffect(() => {
    setDisplayName(userDoc?.displayName ?? "");
    setPhone(userDoc?.phone ?? "");
    setDateOfBirth(userDoc?.dateOfBirth ? formatDateToYYYYMMDD(userDoc.dateOfBirth) : "");
  }, [userDoc?.displayName, userDoc?.phone, userDoc?.dateOfBirth]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await updateMyProfile({
        displayName: displayName.trim(),
        phone: phone.trim(),
        dateOfBirth,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      <div className="text-xs font-medium text-slate-500">My Account</div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Profile</h1>

      {showBirthdayGreeting ? (
        <div className="mt-6 rounded-xl border border-pink-200 bg-pink-50 px-5 py-4 text-slate-900 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-pink-700">Happy Birthday</div>
          <div className="mt-1 text-lg font-semibold">Happy Birthday, {displayName || userDoc?.displayName || "there"}!</div>
          <div className="mt-1 text-sm text-slate-700">Everyone at {companyName} wishes you a wonderful day.</div>
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-4">
          <Link
            href="/profile/me"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            Profile
          </Link>
          <Link
            href="/attendance"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Attendance
          </Link>
          <Link
            href="/attendance"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Leave
          </Link>
          <Link
            href="/employee/payslips"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Payslips
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold tracking-tight">Details</div>
        <div className="mt-3 text-sm text-slate-600">
          <div>UID: {firebaseUser?.uid}</div>
          {userDoc?.employeeId && <div>Employee ID: {userDoc.employeeId}</div>}
          <div>Email: {firebaseUser?.email ?? "—"}</div>
          {userDoc?.designation ? <div>Designation: {userDoc.designation}</div> : null}
          {userDoc?.department ? <div>Department: {userDoc.department}</div> : null}
          <div className="flex items-center gap-2">Role: <RoleBadge role={userDoc?.role || "employee"} /></div>
          <div>Status: {userDoc?.status ?? "—"}</div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold tracking-tight">Edit profile</div>
        <form onSubmit={onSave} className="mt-4 grid gap-4">
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Full name</div>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4"
              required
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Phone</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4"
              placeholder="(optional)"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Date of birth</div>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4"
            />
          </label>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
          {saved ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Saved
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => void signOut().then(() => router.replace("/sign-in"))}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
