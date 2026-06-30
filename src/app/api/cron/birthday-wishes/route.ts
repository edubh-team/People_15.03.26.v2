import { NextResponse } from "next/server";
import { FieldValue, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import { getBirthdayDateKey, getBirthdayPeople, type BirthdayPerson } from "@/lib/birthdays";
import { sendEmail } from "@/lib/email";
import { getAdmin } from "@/lib/firebase/admin";
import type { UserDoc } from "@/lib/types/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_COMPANY_NAME = "Edubh";
const MAX_BATCH_WRITES = 450;

function getCompanyName() {
  return process.env.COMPANY_NAME?.trim() || process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isCronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) return false;

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = url.searchParams.get("key")?.trim();

  return headerSecret === configuredSecret || querySecret === configuredSecret;
}

function buildBirthdayWishHtml(name: string) {
  const safeName = escapeHtml(name);
  const companyName = escapeHtml(getCompanyName());

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%); padding: 40px 24px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em;">Happy Birthday!</h1>
      </div>
      <div style="padding: 32px 24px; background-color: #ffffff;">
        <h2 style="color: #be185d; margin-top: 0; font-size: 20px; font-weight: 700;">Dear ${safeName},</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin-top: 12px;">
          On this special day, the entire team at <strong>${companyName}</strong> wishes you a wonderful birthday.
          Thank you for your hard work, dedication, and the energy you bring to our workplace.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin-top: 16px;">
          May the coming year bring you health, happiness, personal growth, and success in everything you do.
          Enjoy your special day to the fullest.
        </p>
        <div style="margin-top: 32px; border-top: 1px solid #f3f4f6; padding-top: 24px;">
          <p style="font-size: 14px; color: #9ca3af; margin: 0;">Warm regards,</p>
          <p style="font-size: 15px; font-weight: 700; color: #111827; margin: 4px 0 0 0;">${companyName} Team</p>
          <p style="font-size: 12px; color: #9ca3af; margin: 2px 0 0 0;">People Ops & Culture</p>
        </div>
      </div>
      <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #f3f4f6;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          This is an automated birthday wish from ${companyName}.
        </p>
      </div>
    </div>
  `;
}

function getDateInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);

    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Date(year, month - 1, day);
    }
  } catch {
    // Fall through to local server date if Intl timezone parsing fails.
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sanitizeNotificationId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getLocalHour(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    });
    return Number(formatter.format(date));
  } catch {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        hour12: false,
      });
      return Number(formatter.format(date));
    } catch {
      return date.getHours();
    }
  }
}

function formatBirthdayDisplayDate(date: Date) {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function commitBatch(batch: WriteBatch | null, writes: number) {
  if (!batch || writes === 0) return;
  await batch.commit();
}

async function writeBirthdayNotifications(input: {
  adminDb: Firestore;
  users: UserDoc[];
  person: BirthdayPerson;
  source: "birthday_wishes_cron" | "birthday_reminders_cron";
  type: "birthday_today" | "birthday_upcoming";
}) {
  const { adminDb, users, person, source, type } = input;
  const companyName = getCompanyName();
  const birthdayDateKey = getBirthdayDateKey(person.nextBirthday);
  const birthdayDisplayDate = formatBirthdayDisplayDate(person.nextBirthday);
  let batch = adminDb.batch();
  let writes = 0;
  let created = 0;

  for (const user of users) {
    const notificationId = sanitizeNotificationId(`${type}-${birthdayDateKey}-${person.uid}-${user.uid}`);
    const notificationRef = adminDb.collection("notifications").doc(notificationId);

    if (type === "birthday_today" && user.uid === person.uid) {
      batch.set(notificationRef, {
        recipientUid: person.uid,
        title: `Happy Birthday, ${person.name}!`,
        body: `Wishing you a wonderful birthday from all of us at ${companyName}. Have a fantastic day.`,
        read: false,
        type,
        priority: "high",
        birthdayDateKey,
        birthdayDisplayDate,
        birthdayIsoDate: birthdayDateKey,
        daysUntilBirthday: 0,
        relatedUserUid: person.uid,
        relatedUserName: person.name,
        relatedUserDepartment: person.department ?? "General",
        source,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (type === "birthday_today") {
      batch.set(notificationRef, {
        recipientUid: user.uid,
        title: "Colleague birthday today",
        body: `Today is ${person.name}'s birthday. Wish them a happy birthday.`,
        read: false,
        type,
        priority: "high",
        birthdayDateKey,
        birthdayDisplayDate,
        birthdayIsoDate: birthdayDateKey,
        daysUntilBirthday: 0,
        relatedUserUid: person.uid,
        relatedUserName: person.name,
        relatedUserDepartment: person.department ?? "General",
        source,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      batch.set(notificationRef, {
        recipientUid: user.uid,
        title: "Upcoming birthday",
        body: `${person.name}'s birthday is on ${birthdayDisplayDate}.`,
        read: false,
        type,
        priority: person.daysUntil <= 3 ? "high" : "medium",
        birthdayDateKey,
        birthdayDisplayDate,
        birthdayIsoDate: birthdayDateKey,
        daysUntilBirthday: person.daysUntil,
        relatedUserUid: person.uid,
        relatedUserName: person.name,
        relatedUserDepartment: person.department ?? "General",
        source,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    writes += 1;
    created += 1;
    if (writes >= MAX_BATCH_WRITES) {
      await commitBatch(batch, writes);
      batch = adminDb.batch();
      writes = 0;
    }
  }

  await commitBatch(batch, writes);
  return created;
}

export async function GET(request: Request) {
  try {
    if (!process.env.CRON_SECRET?.trim()) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured for birthday wishes." },
        { status: 503 },
      );
    }

    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }

    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const now = new Date();
    const businessTimeZone = process.env.BIRTHDAY_TIMEZONE?.trim() || "Asia/Kolkata";
    const businessToday = getDateInTimeZone(now, businessTimeZone);
    const todayKey = getBirthdayDateKey(businessToday);
    const { adminDb } = await getAdmin();

    const usersSnapshot = await adminDb
      .collection("users")
      .limit(1000)
      .get();
    const users = usersSnapshot.docs
      .map((doc) => ({ uid: doc.id, ...doc.data() }) as UserDoc)
      .filter((user) => user.isActive === true || user.status?.toLowerCase() === "active");

    const birthdaysToday = getBirthdayPeople(users, { now: businessToday, windowDays: 0 }).filter(
      (person) => person.isToday,
    );
    const upcomingBirthdays = getBirthdayPeople(users, { now: businessToday, windowDays: 7 }).filter(
      (person) => !person.isToday && person.daysUntil <= 7,
    );

    let sent = 0;
    let skipped = 0;
    let notificationsCreated = 0;
    let upcomingNotificationsCreated = 0;
    const errors: Array<{ uid: string; email: string | null; error: string }> = [];

    for (const person of birthdaysToday) {
      const timezone = person.timezone || businessTimeZone;
      const localHour = getLocalHour(now, timezone);

      if (localHour < 9) {
        skipped += 1;
        continue;
      }

      const markerId = `${todayKey}-${person.uid}`;
      const markerRef = adminDb.collection("birthdayWishLogs").doc(markerId);
      const marker = await markerRef.get();
      const logData = marker.exists ? marker.data() : null;

      const alreadySentEmail = logData?.status === "success";
      const alreadyNotified = logData?.notificationsGenerated === true;

      if (person.email && !alreadySentEmail && !dryRun) {
        try {
          await sendEmail(
            person.email,
            `Happy Birthday, ${person.name}!`,
            buildBirthdayWishHtml(person.name),
          );

          await markerRef.set({
            uid: person.uid,
            email: person.email,
            name: person.name,
            birthdayDateKey: todayKey,
            status: "success",
            error: null,
            timestamp: FieldValue.serverTimestamp(),
            source: "birthday_wishes_cron",
          }, { merge: true });

          sent += 1;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await markerRef.set({
            uid: person.uid,
            email: person.email,
            name: person.name,
            birthdayDateKey: todayKey,
            status: "failed",
            error: errorMsg,
            timestamp: FieldValue.serverTimestamp(),
            source: "birthday_wishes_cron",
          }, { merge: true });

          errors.push({
            uid: person.uid,
            email: person.email,
            error: errorMsg,
          });
        }
      } else {
        skipped += 1;
      }

      if (!alreadyNotified && !dryRun) {
        try {
          notificationsCreated += await writeBirthdayNotifications({
            adminDb,
            users,
            person,
            source: "birthday_wishes_cron",
            type: "birthday_today",
          });

          await markerRef.set({ notificationsGenerated: true }, { merge: true });
        } catch (notifErr) {
          console.error("Failed to generate in-app notifications for birthday:", notifErr);
        }
      }
    }

    for (const person of upcomingBirthdays) {
      const birthdayDateKey = getBirthdayDateKey(person.nextBirthday);
      const markerId = sanitizeNotificationId(`${birthdayDateKey}-${person.uid}`);
      const markerRef = adminDb.collection("birthdayReminderLogs").doc(markerId);
      const marker = await markerRef.get();

      if (marker.exists || dryRun) {
        if (marker.exists) skipped += 1;
        continue;
      }

      try {
        const created = await writeBirthdayNotifications({
          adminDb,
          users,
          person,
          source: "birthday_reminders_cron",
          type: "birthday_upcoming",
        });

        await markerRef.set({
          uid: person.uid,
          name: person.name,
          department: person.department ?? null,
          birthdayDateKey,
          daysUntilBirthday: person.daysUntil,
          notificationsGenerated: true,
          notificationCount: created,
          timestamp: FieldValue.serverTimestamp(),
          source: "birthday_reminders_cron",
        }, { merge: true });

        upcomingNotificationsCreated += created;
      } catch (reminderErr) {
        console.error("Failed to generate upcoming birthday reminders:", reminderErr);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      dateKey: todayKey,
      matched: birthdaysToday.length,
      upcomingMatched: upcomingBirthdays.length,
      sent,
      skipped,
      notificationsCreated,
      upcomingNotificationsCreated,
      dryRun,
      errors,
    });
  } catch (error) {
    console.error("Birthday wishes cron failed:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
