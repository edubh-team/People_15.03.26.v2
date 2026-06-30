import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface PaginationProps {
  currentPage: number;
  itemsPerPage: number;
  totalCurrentItems: number; // Number of items currently loaded/visible
  hasMore: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  label?: string; // e.g. "results" or "leads"
  totalItems?: number;
}

export default function Pagination({
  currentPage,
  itemsPerPage,
  totalCurrentItems,
  hasMore,
  loading,
  onPrev,
  onNext,
  label = "results",
  totalItems
}: PaginationProps) {
  // Calculate display numbers
  const startCount = (currentPage - 1) * itemsPerPage + 1;
  // If we don't know the total server count, we can only say "Showing X to Y"
  // If we are on the last page or have fewer items than limit, we adjust the end count.
  // However, usually "totalCurrentItems" is the length of the array passed to the table.
  // The end count is startCount + totalCurrentItems - 1
  const endCount = startCount + totalCurrentItems - 1;

  // Edge case: if no items
  if (totalCurrentItems === 0) {
    return null; 
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-700">
            <span className="hidden sm:inline">Showing </span>
            <span className="font-medium">{startCount}</span>
            <span className="hidden sm:inline"> to </span>
            <span className="sm:hidden">-</span>
            <span className="font-medium">{endCount}</span>
            {totalItems !== undefined && (
              <>
                <span className="hidden sm:inline"> of </span>
                <span className="sm:hidden">/</span>
                <span className="font-medium">{totalItems}</span>
              </>
            )}
            <span className="hidden sm:inline"> {label}</span>
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={onPrev}
              disabled={currentPage === 1 || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={onNext}
              disabled={!hasMore || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Next</span>
              <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
