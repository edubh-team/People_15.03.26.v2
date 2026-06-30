import type { UserDoc } from "@/lib/types/user";

export type BirthdayPerson = {
  uid: string;
  name: string;
  email: string | null;
  birthday: Date;
  nextBirthday: Date;
  daysUntil: number;
  isToday: boolean;
  ageTurning: number | null;
  photoURL?: string | null;
  department?: string | null;
  timezone?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const timestamp = value as { toDate?: () => Date };
  if (typeof timestamp?.toDate === "function") {
    const parsed = timestamp.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatDateToYYYYMMDD(value: unknown): string {
  const date = parseDateLike(value);
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getUserBirthday(user: UserDoc): Date | null {
  return (
    parseDateLike(user.dateOfBirth) ??
    parseDateLike(user.dob) ??
    parseDateLike(user.birthDate) ??
    parseDateLike(user.birthday)
  );
}

export function getBirthdayDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function isBirthdayToday(user: UserDoc | null | undefined, now = new Date()) {
  if (!user) return false;
  const birthday = getUserBirthday(user);
  if (!birthday) return false;

  const today = startOfLocalDay(now);
  return birthday.getMonth() === today.getMonth() && birthday.getDate() === today.getDate();
}
export function getBirthdayPeople(
  users: UserDoc[],
  options?: {
    now?: Date;
    windowDays?: number;
  },
) {
  const now = options?.now ?? new Date();
  const windowDays = options?.windowDays ?? 14;
  const today = startOfLocalDay(now);

  return users
    .map((user): BirthdayPerson | null => {
      const birthday = getUserBirthday(user);
      if (!birthday) return null;

      const nextBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
      if (nextBirthday < today) {
        nextBirthday.setFullYear(today.getFullYear() + 1);
      }

      const daysUntil = Math.round((nextBirthday.getTime() - today.getTime()) / DAY_MS);
      if (daysUntil < 0 || daysUntil > windowDays) return null;

      const name = user.displayName ?? user.name ?? user.email ?? user.uid;
      const ageTurning =
        birthday.getFullYear() > 1900 ? nextBirthday.getFullYear() - birthday.getFullYear() : null;

      return {
        uid: user.uid,
        name,
        email: user.email,
        birthday,
        nextBirthday,
        daysUntil,
        isToday: daysUntil === 0,
        ageTurning,
        photoURL: user.photoURL ?? null,
        department: user.department ?? null,
        timezone: user.timezone ?? null,
      };
    })
    .filter((person): person is BirthdayPerson => Boolean(person))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

export function formatBirthdayTiming(person: BirthdayPerson) {
  if (person.isToday) return "Today";
  if (person.daysUntil === 1) return "Tomorrow";
  return `In ${person.daysUntil} days`;
}
