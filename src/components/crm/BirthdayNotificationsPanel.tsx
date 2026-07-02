"use client";

import { CakeIcon, BellIcon } from "@heroicons/react/24/outline";
import { formatBirthdayTiming, getBirthdayPeople } from "@/lib/birthdays";
import type { UserDoc } from "@/lib/types/user";
import Image from "next/image";

type BirthdayNotificationsPanelProps = {
  users: UserDoc[];
  loading?: boolean;
  className?: string;
};

export function BirthdayNotificationsPanel({
  users,
  loading = false,
  className = "",
}: BirthdayNotificationsPanelProps) {
  // Get upcoming birthdays in the next 30 days
  const birthdays = getBirthdayPeople(users, { windowDays: 30 });
  const todaysBirthdays = birthdays.filter((person) => person.isToday);
  
  // Find birthdays within the next 7 days for notification alerts
  const alertBirthdays = birthdays.filter((person) => person.daysUntil <= 7);

  return (
    <section
      className={`rounded-[32px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Birthday Hub</h3>
          <p className="mt-1 text-xs text-slate-500">Today and upcoming employee birthdays</p>
        </div>
        <div className="rounded-2xl bg-pink-500/10 p-3 text-pink-600 ring-4 ring-pink-50">
          <CakeIcon className="h-5 w-5" />
        </div>
      </div>

      {/* Birthday Alert Notification (Within 7 Days) */}
      {!loading && alertBirthdays.length > 0 && (
        <div className="mt-5 space-y-3">
          {alertBirthdays.map((person) => (
            <div
              key={`alert-${person.uid}`}
              className="flex gap-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-4 animate-in fade-in slide-in-from-top-2 duration-300"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-100 text-pink-600">
                <BellIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">
                  {person.isToday 
                    ? `🎉 Today is ${person.name}'s Birthday!`
                    : `🔔 Upcoming Birthday: ${person.name}`}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {person.isToday
                    ? `Wish them a wonderful day! ${person.department ? `(${person.department} department)` : ""}`
                    : `${person.name} from the ${person.department || "General"} department has a birthday ${formatBirthdayTiming(person).toLowerCase()} on ${person.nextBirthday.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Birthday List */}
      <div className="mt-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : birthdays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500 text-center">
            No birthdays in the next 30 days.
          </div>
        ) : (
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {birthdays.map((person) => (
              <div
                key={person.uid}
                className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50/50 p-3 hover:bg-slate-50/80 transition-colors border border-slate-100/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Profile Picture */}
                  {person.photoURL ? (
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200">
                      <Image
                        src={person.photoURL}
                        alt={person.name}
                        fill
                        className="object-cover"
                        sizes="40px"
                      />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-bold text-indigo-600 border border-indigo-200">
                      {person.name.trim().slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  {/* Name and Department */}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {person.name}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {person.department || "General"}
                    </div>
                  </div>
                </div>

                {/* Birthday Date & Label */}
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold text-slate-800">
                    {person.nextBirthday.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </div>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      person.isToday
                        ? "bg-pink-600 text-white animate-pulse"
                        : person.daysUntil <= 7
                        ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200"
                        : "bg-white text-slate-600 ring-1 ring-slate-200/50"
                    }`}
                  >
                    {formatBirthdayTiming(person)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
