"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { createDirectSaleLead } from "@/lib/firebase/leads";
import { useAuth } from "@/components/auth/AuthProvider";
import UniversityCourseSelector from "./UniversityCourseSelector";
import { UNIVERSITY_DATA, UniversityName } from "./UniversityConfig";
import { toTitleCase } from "@/lib/utils/stringUtils";

type DirectSaleFormData = {
  name: string;
  phone: string;
  email: string;
  state: string;
  university: UniversityName;
  course: string;
  fee: number;
  paymentMode: string;
  utrNumber: string;
};

type Props = {
  onSuccess: () => void;
  onCancel: () => void;
};

export default function DirectSaleForm({ onSuccess, onCancel }: Props) {
  const { firebaseUser, userDoc } = useAuth(); // Assuming this hook provides current user info
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DirectSaleFormData>();

  const onSubmit = async (data: DirectSaleFormData) => {
    if (!firebaseUser || !userDoc) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await createDirectSaleLead(
        {
          name: toTitleCase(data.name),
          phone: data.phone,
          email: data.email,
          state: data.state,
          university: data.university,
          course: data.course,
          fee: data.fee,
          registrationFee: UNIVERSITY_DATA[data.university]?.registrationFee ?? 0,
          paymentMode: data.paymentMode,
          utrNumber: data.utrNumber,
        },
        {
          uid: firebaseUser.uid,
          displayName: userDoc.displayName || firebaseUser.email || "Unknown",
          role: userDoc.role,
          orgRole: userDoc.orgRole,
          employeeId: userDoc.employeeId,
          email: userDoc.email ?? firebaseUser.email,
        }
      );
      onSuccess();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to create direct sale lead.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
          {error}
        </div>
      )}

      {/* Section A: Lead Profile */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
          Lead Profile
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              {...register("name", { required: "Name is required" })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="John Doe"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              {...register("phone", { 
                required: "Phone is required",
                pattern: {
                    value: /^[0-9]{10}$/,
                    message: "Please enter a valid 10-digit phone number"
                }
             })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="9876543210"
            />
            {errors.phone && (
              <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Email Address
            </label>
            <input
              type="email"
              {...register("email", {
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: "Invalid email address",
                },
              })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="john@example.com"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              State / Region
            </label>
            <input
              type="text"
              {...register("state")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Maharashtra"
            />
          </div>
        </div>
      </div>

      {/* Section B: Sales Logic */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-indigo-900 border-b border-indigo-200 pb-2">
          Sale & Enrollment Details
        </h3>
        
        <UniversityCourseSelector
          register={register}
          watch={watch}
          setValue={setValue}
          errors={errors}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Payment Mode <span className="text-red-500">*</span>
            </label>
            <select
              {...register("paymentMode", { required: "Payment mode is required" })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Select Mode</option>
              <option value="UPI">UPI</option>
              <option value="NEFT/IMPS">NEFT / IMPS</option>
              <option value="Cheque">Cheque</option>
              <option value="Cash">Cash</option>
              <option value="Credit Card">Credit Card</option>
              <option value="Loan">Loan</option>
            </select>
            {errors.paymentMode && (
              <p className="mt-1 text-xs text-red-600">{errors.paymentMode.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              UTR / Transaction ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              {...register("utrNumber", { required: "UTR / Transaction ID is required" })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Enter Transaction ID"
            />
            {errors.utrNumber && (
              <p className="mt-1 text-xs text-red-600">{errors.utrNumber.message}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSubmitting ? "Punching Sale..." : "Punch Direct Sale"}
        </button>
      </div>
    </form>
  );
}
