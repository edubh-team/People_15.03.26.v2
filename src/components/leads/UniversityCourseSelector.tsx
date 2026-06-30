"use client";

import { useEffect } from "react";
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors, FieldValues, Path, PathValue } from "react-hook-form";
import { UNIVERSITY_DATA, UniversityName } from "./UniversityConfig";

type Props<T extends FieldValues> = {
  register: UseFormRegister<T>;
  watch: UseFormWatch<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<T>;
  universityFieldName?: Path<T>;
  courseFieldName?: Path<T>;
  feeFieldName?: Path<T>;
};

export default function UniversityCourseSelector<T extends FieldValues>({
  register,
  watch,
  setValue,
  errors,
  universityFieldName = "university" as Path<T>,
  courseFieldName = "course" as Path<T>,
  feeFieldName = "fee" as Path<T>,
}: Props<T>) {
  const selectedUniversity = watch(universityFieldName);
  const selectedCourseName = watch(courseFieldName);
  const selectedUniversityConfig = selectedUniversity
    ? UNIVERSITY_DATA[selectedUniversity as UniversityName]
    : null;

  // Reset dependent fields when university changes
  useEffect(() => {
    // Only reset if the values are actually different to avoid infinite loops or unnecessary resets
    // logic handled by user action mostly, but here for safety
    if (!selectedUniversity) {
        setValue(courseFieldName, "" as PathValue<T, Path<T>>);
        setValue(feeFieldName, 0 as PathValue<T, Path<T>>);
    }
  }, [selectedUniversity, setValue, courseFieldName, feeFieldName]);

  // Update fee when course changes
  useEffect(() => {
    if (selectedUniversity && selectedCourseName) {
      const uniData = UNIVERSITY_DATA[selectedUniversity as UniversityName];
      const course = uniData?.courses.find((c) => c.name === selectedCourseName);
      if (course) {
        setValue(feeFieldName, course.fee as PathValue<T, Path<T>>);
      }
    }
  }, [selectedUniversity, selectedCourseName, setValue, feeFieldName]);

  const universityOptions = Object.keys(UNIVERSITY_DATA) as UniversityName[];
  const courseOptions = selectedUniversity
    ? UNIVERSITY_DATA[selectedUniversity as UniversityName]?.courses || []
    : [];

  return (
    <>
      {/* University Dropdown */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">
          University <span className="text-red-500">*</span>
        </label>
        <select
          {...register(universityFieldName, { required: "University is required", 
            onChange: () => {
                setValue(courseFieldName, "" as PathValue<T, Path<T>>);
                setValue(feeFieldName, 0 as PathValue<T, Path<T>>);
            }
           })}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Select University</option>
          {universityOptions.map((uni) => (
            <option key={uni} value={uni}>
              {uni}
            </option>
          ))}
        </select>
        {errors[universityFieldName] && (
          <p className="mt-1 text-xs text-red-600">{errors[universityFieldName]?.message as string}</p>
        )}
      </div>

      {/* Course Dropdown */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Degree / Course <span className="text-red-500">*</span>
        </label>
        <select
          {...register(courseFieldName, { required: "Course is required" })}
          disabled={!selectedUniversity}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Select Course</option>
          {courseOptions.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        {errors[courseFieldName] && (
          <p className="mt-1 text-xs text-red-600">{errors[courseFieldName]?.message as string}</p>
        )}
      </div>

      {/* Course Fees (Read-Only) */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Course Fees <span className="text-xs text-slate-500">(Auto-populated)</span>
        </label>
        <input
          type="number"
          {...register(feeFieldName)}
          readOnly
          className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 focus:outline-none"
        />
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Registration Fee <span className="text-xs text-slate-500">(By university)</span>
        </label>
        <input
          type="number"
          value={selectedUniversityConfig?.registrationFee ?? 0}
          readOnly
          className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 focus:outline-none"
        />
        {selectedUniversityConfig && selectedUniversityConfig.registrationFee > 0 ? (
          <p className="mt-1 text-[11px] text-slate-500">
            Registration fee is tracked separately from course fee.
            {String(selectedUniversity).toLowerCase().includes("lpu") ? " (Non-refundable)." : ""}
          </p>
        ) : null}
      </div>
    </>
  );
}
