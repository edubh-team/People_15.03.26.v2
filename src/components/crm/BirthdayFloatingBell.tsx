"use client";

import { useMemo, useState } from "react";
import { BellIcon, CakeIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getBirthdayPeople } from "@/lib/birthdays";
import type { UserDoc } from "@/lib/types/user";

type BirthdayFloatingBellProps = {
  users: UserDoc[];
  loading?: boolean;
};

function formatBirthdayDate(date: Date) {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function BirthdayFloatingBell({ users, loading = false }: BirthdayFloatingBellProps) {
  const [open, setOpen] = useState(false);
  const todaysBirthdays = useMemo(
    () => getBirthdayPeople(users, { windowDays: 0 }).filter((person) => person.isToday),
    [users],
  );
  const count = todaysBirthdays.length;

  return (
    <div className="fixed bottom-20 right-5 z-50 md:bottom-5">
      {open ? (
        <div className="mb-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-pink-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-pink-100 bg-pink-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-pink-100 text-pink-700">
                <CakeIcon className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">Today&apos;s birthdays</div>
                <div className="text-xs text-slate-600">Employee birthday details</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-white"
              aria-label="Close birthday pop-up"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto px-4 py-3">
            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((item) => (
                  <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : count === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                No employee birthdays today.
              </div>
            ) : (
              <div className="space-y-2">
                {todaysBirthdays.map((person) => (
                  <div key={person.uid} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="text-sm font-semibold text-slate-900">{person.name}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      Birthday: {formatBirthdayDate(person.nextBirthday)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-600 text-white shadow-lg shadow-pink-600/25 transition hover:bg-pink-700 focus:outline-none focus:ring-4 focus:ring-pink-200"
        aria-label="Open birthday notifications"
      >
        <BellIcon className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
    </div>
  );
}