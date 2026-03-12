"use client";

import { Fragment, useMemo, useState } from "react";
import { Dialog, Transition, TransitionChild, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isToday, 
  getDay,
  isWeekend
} from "date-fns";
import { useAttendanceMonth, useHolidaysMonth } from "@/lib/hooks/useAttendance";
import type { AttendanceDayDoc } from "@/lib/types/attendance";
import { Timestamp } from "firebase/firestore";

type Props = {
  uid: string | null;
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
};

export default function AttendanceCalendarModal({ uid, isOpen, onClose, userName }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const monthIndex = currentDate.getMonth();

  const attendanceQuery = useAttendanceMonth(uid, year, monthIndex);
  const holidaysQuery = useHolidaysMonth(year, monthIndex);

  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceDayDoc>();
    if (attendanceQuery.data) {
      for (const day of attendanceQuery.data) {
        map.set(day.dateKey, day);
      }
    }
    return map;
  }, [attendanceQuery.data]);

  const holidaysMap = useMemo(() => {
    const map = new Map<string, string>(); // dateKey -> holidayName
    if (holidaysQuery.data) {
      for (const h of holidaysQuery.data) {
        map.set(h.dateKey, h.name);
      }
    }
    return map;
  }, [holidaysQuery.data]);

  // Calendar grid logic
  const startDay = getDay(startOfMonth(currentDate)); // 0 = Sunday
  const blanks = Array(startDay).fill(null);

  const getDayStatus = (date: Date) => {
    const key = format(date, "yyyy-MM-dd");
    const isWknd = isWeekend(date);
    
    // Check Holiday
    if (holidaysMap.has(key)) return { type: 'holiday', label: holidaysMap.get(key) };

    // Check Attendance Record
    if (attendanceMap.has(key)) {
      const record = attendanceMap.get(key)!;
      if (record.dayStatus === 'on_leave') return { type: 'leave', label: 'On Leave' };
      if (record.status === 'checked_in' || record.status === 'checked_out') return { type: 'present', label: 'Present' };
      // If record exists but not present/leave (e.g. absent marked explicitly), treat as absent
      return { type: 'absent', label: 'Absent' };
    }

    // Default: If today or past, assume absent unless weekend
    if (isWknd) return { type: 'weekend', label: 'Weekend' };
    
    // Simple logic: if date < today and no record, it's Absent (or not marked)
    // For future dates, it's just empty
    if (date < new Date() && !isToday(date)) return { type: 'absent', label: 'Absent' };

    return { type: 'none', label: '' };
  };

  const getStatusColor = (type: string) => {
    switch (type) {
      case 'present': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'leave': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'absent': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'holiday': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'weekend': return 'bg-gray-50 text-gray-400';
      default: return 'bg-white text-gray-700 hover:bg-gray-50';
    }
  };

  const formatTime = (val: unknown) => {
    if (!val) return '--:--';
    if (val instanceof Timestamp) return format(val.toDate(), 'HH:mm');
    if (val instanceof Date) return format(val, 'HH:mm');
    return '--:--';
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-3xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <DialogTitle as="h3" className="text-xl font-bold text-gray-900">
                      Attendance Record
                    </DialogTitle>
                    <p className="text-sm text-gray-500">
                      {userName ? `Detailed view for ${userName}` : 'Monthly overview'}
                    </p>
                  </div>
                  <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                    <XMarkIcon className="w-6 h-6 text-gray-500" />
                  </button>
                </div>

                {/* Calendar Controls */}
                <div className="flex items-center justify-between mb-6 bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <button 
                    onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                    className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600"
                  >
                    <ChevronLeftIcon className="w-5 h-5" />
                  </button>
                  <span className="text-lg font-bold text-gray-800">
                    {format(currentDate, "MMMM yyyy")}
                  </span>
                  <button 
                    onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                    className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600"
                  >
                    <ChevronRightIcon className="w-5 h-5" />
                  </button>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-4 mb-6 text-xs justify-center">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span> Present
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500"></span> On Leave
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500"></span> Absent
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-500"></span> Holiday
                  </div>
                </div>

                {/* Calendar Grid */}
                {attendanceQuery.isLoading ? (
                   <div className="h-64 flex items-center justify-center text-gray-400">Loading calendar data...</div>
                ) : (
                  <div className="grid grid-cols-7 gap-2 text-center">
                    {/* Weekday Headers */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                      <div key={day} className="text-xs font-semibold text-gray-400 uppercase py-2">
                        {day}
                      </div>
                    ))}

                    {/* Blanks */}
                    {blanks.map((_, i) => (
                      <div key={`blank-${i}`} className="aspect-square"></div>
                    ))}

                    {/* Days */}
                    {daysInMonth.map((date) => {
                      const { type, label } = getDayStatus(date);
                      const isTodayDate = isToday(date);
                      const key = format(date, 'yyyy-MM-dd');
                      const record = attendanceMap.get(key);

                      return (
                        <div 
                          key={key}
                          className={`
                            aspect-square rounded-xl border p-1 flex flex-col items-center justify-center relative group cursor-default
                            ${getStatusColor(type)}
                            ${isTodayDate ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}
                          `}
                        >
                          <span className={`text-sm font-bold ${type === 'weekend' ? 'opacity-50' : ''}`}>
                            {format(date, 'd')}
                          </span>
                          
                          {/* Status Dot / Label */}
                          {type !== 'none' && type !== 'weekend' && (
                            <span className="text-[10px] font-medium mt-1 truncate w-full px-1">
                              {label}
                            </span>
                          )}

                          {/* Tooltip for Check-in/out times */}
                          {type === 'present' && record && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded-lg shadow-lg whitespace-nowrap z-10">
                              <div className="font-semibold">{format(date, 'MMM dd, yyyy')}</div>
                              <div>In: {formatTime(record.checkedInAt)}</div>
                              <div>Out: {formatTime(record.checkedOutAt)}</div>
                              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-8 border-transparent border-t-gray-900"></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
