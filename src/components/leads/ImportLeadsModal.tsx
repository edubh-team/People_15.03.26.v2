"use client";

import { useState, useRef } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { 
  CloudArrowUpIcon, 
  XMarkIcon, 
  ExclamationTriangleIcon,
  DocumentArrowDownIcon
} from "@heroicons/react/24/outline";
import { processLeadImport, type ImportResult } from "@/lib/leads/processImport";
import clsx from "clsx";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function ImportLeadsModal({ isOpen, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setProgress({ processed: 0, total: 0 });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setResult(null);
      setProgress({ processed: 0, total: 0 });
    }
  };

  const handleStartImport = async () => {
    if (!file) return;

    setIsProcessing(true);
    setResult(null);
    setProgress({ processed: 0, total: 0 });

    const res = await processLeadImport(file, (processed, total) => {
      setProgress({ processed, total });
    });

    setResult(res);
    setIsProcessing(false);

    if (res.success > 0 && onSuccess) {
      onSuccess();
    }
  };

  const handleClose = () => {
    if (isProcessing) return; // Prevent closing while processing
    setFile(null);
    setResult(null);
    setProgress({ processed: 0, total: 0 });
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Bulk Lead Import
            </DialogTitle>
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="rounded-full p-1 hover:bg-gray-100 disabled:opacity-50"
            >
              <XMarkIcon className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {!result ? (
            <div className="space-y-4">
              {/* File Upload Area */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className={clsx(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                  file
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-300 hover:border-gray-400"
                )}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".xlsx"
                  onChange={handleFileSelect}
                  disabled={isProcessing}
                />
                
                {file ? (
                  <div className="flex flex-col items-center">
                    <DocumentArrowDownIcon className="h-10 w-10 text-indigo-600 mb-2" />
                    <span className="text-sm font-medium text-gray-900">
                      {file.name}
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <CloudArrowUpIcon className="h-10 w-10 text-gray-400 mb-2" />
                    <span className="text-sm font-medium text-gray-900">
                      Click or drag file to upload
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      Supports .xlsx files
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              {isProcessing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Importing...</span>
                    <span>
                      {progress.processed} of {progress.total}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-300"
                      style={{
                        width: `${
                          progress.total > 0
                            ? (progress.processed / progress.total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartImport}
                  disabled={!file || isProcessing}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? "Importing..." : "Start Import"}
                </button>
              </div>
            </div>
          ) : (
            // Results View
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Total Processed</span>
                  <span className="text-sm font-bold text-gray-900">{result.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-700">Success</span>
                  <span className="text-sm font-bold text-green-700">{result.success}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-red-700">Failed</span>
                  <span className="text-sm font-bold text-red-700">{result.failed}</span>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-lg p-4 bg-red-50 max-h-40 overflow-y-auto">
                  <div className="flex items-center gap-2 mb-2 text-red-800 font-medium text-sm">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    <span>Errors ({result.errors.length})</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
