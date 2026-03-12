"use client";

import { useForm } from "react-hook-form";
import { UniversityName } from "./UniversityConfig";
import { GlassButton } from "@/components/ui/GlassButton";
import UniversityCourseSelector from "./UniversityCourseSelector";

export type ClosureFormData = {
  university: UniversityName;
  course: string;
  fee: number;
  emiDetails: string;
};

type Props = {
  onSubmit: (data: ClosureFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
};

export default function ClosureForm({ onSubmit, onCancel, isSubmitting = false }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ClosureFormData>();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-indigo-900">
          Enrollment Details
        </h3>

        <UniversityCourseSelector
          register={register}
          watch={watch}
          setValue={setValue}
          errors={errors}
        />

        {/* UTR / Loan Details */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Monthly EMI / UTR Details <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            {...register("emiDetails", { required: "Payment details are required" })}
            placeholder="Enter UTR number or EMI plan details"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.emiDetails && (
            <p className="mt-1 text-xs text-red-600">{errors.emiDetails.message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <GlassButton
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2"
        >
          {isSubmitting ? "Processing..." : "Confirm & Close Lead"}
        </GlassButton>
      </div>
    </form>
  );
}
