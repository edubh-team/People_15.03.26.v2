"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";

type Props = {
  title: string;
  value: string | number;
  icon?: ReactNode;
  trend?: string; // e.g., "↑ 12% vs last month"
  trendColor?: "green" | "red" | "slate";
  children?: ReactNode; // For charts or extra content
  className?: string;
  loading?: boolean;
};

export function DashboardCard({
  title,
  value,
  icon,
  trend,
  trendColor = "slate",
  children,
  className = "",
  loading = false,
}: Props) {
  if (loading) {
    return <DashboardCardSkeleton className={className} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm ${className}`}
    >
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-500">{title}</h3>
          {icon && <div className="text-slate-400">{icon}</div>}
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 tracking-tight">{value}</span>
          {trend && (
            <span
              className={`text-xs font-medium ${
                trendColor === "green"
                  ? "text-emerald-600"
                  : trendColor === "red"
                  ? "text-rose-600"
                  : "text-slate-500"
              }`}
            >
              {trend}
            </span>
          )}
        </div>
      </div>
      {children && <div className="mt-4 flex-1">{children}</div>}
    </motion.div>
  );
}

export function DashboardCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col justify-between rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm ${className}`}
    >
      <div className="animate-pulse space-y-4">
        <div className="flex justify-between">
          <div className="h-4 w-24 rounded bg-slate-100" />
          <div className="h-5 w-5 rounded bg-slate-100" />
        </div>
        <div className="h-8 w-32 rounded bg-slate-100" />
      </div>
      <div className="mt-4 flex-1 animate-pulse rounded bg-slate-50" />
    </div>
  );
}
