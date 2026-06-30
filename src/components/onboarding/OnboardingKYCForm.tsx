"use client";

import { useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";
import { getHomeRoute } from "@/lib/utils/routing";

export default function OnboardingKYCForm({ currentUser }: { currentUser: UserDoc }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    aadhar: "",
    pan: "",
    university: "",
    education: "",
    bankAccount: "",
    ifsc: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const validate = () => {
    if (!/^\d{12}$/.test(formData.aadhar)) {
      return "Aadhar must be exactly 12 digits.";
    }
    if (!/^[A-Z0-9]{10}$/.test(formData.pan.toUpperCase())) {
      return "PAN must be 10 alphanumeric characters.";
    }
    if (!formData.university.trim()) return "University is required.";
    if (!formData.education.trim()) return "Education is required.";
    if (!formData.bankAccount.trim()) return "Bank Account is required.";
    if (!formData.ifsc.trim()) return "IFSC Code is required.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!db) throw new Error("Firebase not initialized");
      const userRef = doc(db, "users", currentUser.uid);

      // CRITICAL: We set a flag 'onboardingCompleted: true'
      // The Security Rules will use this flag to BLOCK future edits.
      await updateDoc(userRef, {
        kycDetails: {
            aadhar: formData.aadhar,
            pan: formData.pan.toUpperCase(),
            university: formData.university,
            education: formData.education,
            bankAccount: formData.bankAccount,
            ifsc: formData.ifsc.toUpperCase(),
            address: null, // Preserving existing structure
            parentDetails: null, // Preserving existing structure
        },
        onboardingCompleted: true, // The Lock Key
        onboardingTimestamp: serverTimestamp(),
      });

      // Redirect to Dashboard on success
      // Force a reload or router push to refresh auth state if needed, 
      // but simpler to just push to dashboard where AuthGate checks will pass now.
      window.location.href = getHomeRoute(currentUser.role, currentUser.orgRole);
    } catch (err) {
      console.error("Onboarding failed:", err);
      setError("Error saving details. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-white shadow-md rounded-xl mt-6 border border-slate-100">
      <h2 className="text-xl font-bold mb-2 text-slate-900">Welcome, {currentUser.displayName}</h2>
      <p className="text-slate-500 text-sm mb-6">
        Please complete your profile to access the dashboard. <br />
        <span className="text-rose-500 font-medium">These details cannot be changed later. Please fill it with atmost care</span>
      </p>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">Aadhar Number</span>
              <input
                type="text"
                name="aadhar"
                value={formData.aadhar}
                onChange={handleChange}
                placeholder="12-digit number"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">PAN Number</span>
              <input
                type="text"
                name="pan"
                value={formData.pan}
                onChange={handleChange}
                placeholder="ABCDE1234F"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border uppercase"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">Highest Education</span>
              <input
                type="text"
                name="education"
                value={formData.education}
                onChange={handleChange}
                placeholder="e.g. B.Tech, MBA"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">University / Board</span>
              <input
                type="text"
                name="university"
                value={formData.university}
                onChange={handleChange}
                placeholder="University Name"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">Bank Account Number</span>
              <input
                type="text"
                name="bankAccount"
                value={formData.bankAccount}
                onChange={handleChange}
                placeholder="Account Number"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 tracking-wide">IFSC Code</span>
              <input
                type="text"
                name="ifsc"
                value={formData.ifsc}
                onChange={handleChange}
                placeholder="IFSC Code"
                className="mt-1 block w-full rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 text-xs text-slate-600 px-3 py-2 border uppercase"
                required
              />
            </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-2.5 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-200"
        >
          {loading ? "Locking Profile..." : "Submit & Complete Setup"}
        </button>
      </form>
    </div>
  );
}
