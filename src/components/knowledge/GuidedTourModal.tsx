"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import type { GuidedTourStep } from "@/lib/knowledge-center/content";

type GuidedTourModalProps = {
  open: boolean;
  roleLabel: string;
  steps: GuidedTourStep[];
  stepIndex: number;
  onStepChange: (next: number) => void;
  onClose: () => void;
  onComplete: () => void;
};

export function GuidedTourModal(props: GuidedTourModalProps) {
  const total = props.steps.length;
  const step = props.steps[props.stepIndex];
  const canGoBack = props.stepIndex > 0;
  const canGoNext = props.stepIndex < total - 1;

  if (!step) return null;

  return (
    <AnimatePresence>
      {props.open ? (
        <div className="fixed inset-0 z-[90]">
          <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" />
          <div className="relative mx-auto mt-16 max-w-2xl px-4 sm:mt-24">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            >
              <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Guided Tour
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{props.roleLabel}</div>
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-indigo-600 transition-all"
                    style={{ width: `${((props.stepIndex + 1) / Math.max(total, 1)) * 100}%` }}
                  />
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Step {props.stepIndex + 1} of {total}
                </div>
                <div className="text-xl font-semibold text-slate-900">{step.title}</div>
                <p className="text-sm leading-6 text-slate-600">{step.description}</p>
                {step.route ? (
                  <Link
                    href={step.route}
                    className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Open related page
                  </Link>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-6 py-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onStepChange(Math.max(0, props.stepIndex - 1))}
                    disabled={!canGoBack}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onStepChange(Math.min(total - 1, props.stepIndex + 1))}
                    disabled={!canGoNext}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={props.onClose}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Close for now
                  </button>
                  <button
                    type="button"
                    onClick={props.onComplete}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Mark as understood
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
