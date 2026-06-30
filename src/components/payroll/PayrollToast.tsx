"use client";

type Props = {
  tone: "success" | "error" | "info";
  message: string;
};

const tones = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-slate-200 bg-slate-50 text-slate-700",
} as const;

export default function PayrollToast({ tone, message }: Props) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${tones[tone]}`}>
      {message}
    </div>
  );
}
