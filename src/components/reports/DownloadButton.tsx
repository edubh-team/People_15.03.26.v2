"use client";

import { useState } from "react";
import { ArrowDownTrayIcon, ArrowPathIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { pdf } from "@react-pdf/renderer";
import { fetchReportData, type ReportData } from "@/lib/reports/fetchReportData";
import EmployeeReportDocument from "@/components/pdf/EmployeeReportDocument";
import { isSameMonth, endOfMonth, getDate } from "date-fns";

type Props = {
  employeeId: string;
  month: Date;
  className?: string;
};

export default function DownloadReportButton({ employeeId, month, className = "" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Availability Logic: Only allow download in the last 3 days of the month for the current month
  const today = new Date();
  const isCurrentMonth = isSameMonth(month, today);
  
  let isAvailable = true;
  let availabilityMessage = "";

  if (isCurrentMonth) {
    const lastDay = endOfMonth(today);
    const totalDays = getDate(lastDay);
    const currentDay = getDate(today);
    
    // Last 3 days: e.g. if 31 days, allowed on 29, 30, 31
    // 31 - 29 = 2. So difference <= 2
    if (totalDays - currentDay > 2) {
      isAvailable = false;
      availabilityMessage = "Report generation is only available during the last 3 days of the month.";
    }
  }

  const handleDownload = async () => {
    if (!isAvailable) return;
    
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch Data
      const data: ReportData = await fetchReportData(employeeId, month);

      // 2. Generate PDF Blob
      // We use the pdf() function from @react-pdf/renderer to generate a blob imperatively
      const blob = await pdf(<EmployeeReportDocument data={data} />).toBlob();

      // 3. Trigger Download
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Performance_Report_${data.employeeName.replace(/\s+/g, "_")}_${data.reportMonth.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (err: unknown) {
      console.error("Failed to generate report:", err);
      
      let errorMessage = "Failed to generate report. Please try again.";
      
      // Check for Firestore missing index error
      const firestoreError = err as { code?: string; message?: string };
      if (firestoreError?.code === 'failed-precondition' && firestoreError?.message?.includes('index')) {
         errorMessage = "Database index is building. Please try again in a few minutes.";
         console.log("Missing Index Link:", firestoreError.message); // Helper for developer console
      }

      setError(errorMessage);
      alert(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-block group">
      <button
        onClick={handleDownload}
        disabled={loading || !isAvailable}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors 
          ${!isAvailable 
            ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200" 
            : "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed"
          } ${className}`}
        title={!isAvailable ? availabilityMessage : "Download Monthly Report"}
      >
        {loading ? (
          <>
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
            <span>Generating...</span>
          </>
        ) : !isAvailable ? (
          <>
            <LockClosedIcon className="h-4 w-4" />
            <span>Report Locked</span>
          </>
        ) : (
          <>
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>Download PDF Report</span>
          </>
        )}
      </button>
      
      {/* Tooltip for unavailable state */}
      {!isAvailable && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center z-20">
          {availabilityMessage}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
        </div>
      )}

      {error && (
        <div className="absolute top-full mt-2 left-0 w-max max-w-xs rounded bg-red-50 p-2 text-xs text-red-600 shadow-sm border border-red-100 z-10">
          {error}
        </div>
      )}
    </div>
  );
}
