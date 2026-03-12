"use client";

import React, { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import PayslipDocument from './PayslipDocument';
import { Payroll } from '@/lib/types/hr';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';

interface DownloadPayslipButtonProps {
  payroll: Payroll;
}

const DownloadPayslipButton: React.FC<DownloadPayslipButtonProps> = ({ payroll }) => {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    try {
      setLoading(true);
      const blob = await pdf(<PayslipDocument payroll={payroll} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payslip_${payroll.month}_${(payroll.userDisplayName || 'emp').replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={handleDownload}
      disabled={loading}
      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50 transition-colors"
      title="Download Payslip"
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      ) : (
        <ArrowDownTrayIcon className="w-5 h-5" />
      )}
    </button>
  );
};

export default DownloadPayslipButton;
