import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { buildFinanceAccountDirectory, normalizeAccountNumber, normalizeIfscCode, normalizePhone } from "@/lib/finance/accountDirectory";
import { requireFinanceRequestUser } from "@/lib/server/request-auth";
import { type AccountPerson, type FinanceAccountDirectoryResponse } from "@/lib/types/finance";
import type { UserDoc } from "@/lib/types/user";

export const runtime = "nodejs";

type DirectoryCacheEntry = {
  data: FinanceAccountDirectoryResponse;
  expiresAt: number;
};

const DIRECTORY_CACHE_TTL_MS = 1000 * 60;
const STALE_DIRECTORY_CACHE_TTL_MS = 1000 * 60 * 10;
let directoryCache: DirectoryCacheEntry | null = null;
let pendingDirectoryRead: Promise<FinanceAccountDirectoryResponse> | null = null;

function noStoreJson(body: FinanceAccountDirectoryResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getFirebaseErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  return "";
}

async function loadFinanceAccountDirectory(
  adminDb: Firestore,
): Promise<FinanceAccountDirectoryResponse> {
  const now = Date.now();
  if (directoryCache && directoryCache.expiresAt > now) {
    return directoryCache.data;
  }

  if (pendingDirectoryRead) {
    return pendingDirectoryRead;
  }

  pendingDirectoryRead = Promise.all([
    adminDb.collection("users").get(),
    adminDb.collection("finance_external_accounts").get(),
  ])
    .then(([usersSnap, externalSnap]) => {
      const directory = buildFinanceAccountDirectory({
        users: usersSnap.docs.map(
          (doc) =>
            ({
              ...(doc.data() as UserDoc),
              uid: doc.id,
            }) as UserDoc,
        ),
        externalAccounts: externalSnap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Partial<AccountPerson>,
        })),
      });
      directoryCache = {
        data: directory,
        expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS,
      };
      return directory;
    })
    .catch((error) => {
      if (
        directoryCache &&
        directoryCache.expiresAt + STALE_DIRECTORY_CACHE_TTL_MS > Date.now() &&
        getFirebaseErrorCode(error) === "8"
      ) {
        return directoryCache.data;
      }
      throw error;
    })
    .finally(() => {
      pendingDirectoryRead = null;
    });

  return pendingDirectoryRead;
}

export async function GET(req: Request) {
  const verified = await requireFinanceRequestUser(req);
  if (!verified.ok) return verified.response;

  const { adminDb } = verified.value;

  try {
    const directory = await loadFinanceAccountDirectory(adminDb);
    return noStoreJson(directory);
  } catch (err: any) {
    console.error("Finance account directory error:", err);
    if (getFirebaseErrorCode(err) === "8") {
      return NextResponse.json(
        { error: "Firebase quota exceeded while loading finance accounts. Please retry shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to load finance account directory" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const verified = await requireFinanceRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const { adminDb, uid } = verified.value;

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const accountNumber =
      typeof body.accountNumber === "string" ? normalizeAccountNumber(body.accountNumber) : "";
    const ifscCode =
      typeof body.ifscCode === "string" ? normalizeIfscCode(body.ifscCode) : "";

    if (!name || !phone || !email || !accountNumber || !ifscCode) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    if (!/^[+\d][\d\s-]{6,}$/.test(phone)) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    if (!/^\d{6,20}$/.test(accountNumber)) {
      return NextResponse.json(
        { error: "Account number must be 6-20 digits" },
        { status: 400 },
      );
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return NextResponse.json({ error: "Enter a valid IFSC code" }, { status: 400 });
    }

    const duplicateSnap = await adminDb
      .collection("finance_external_accounts")
      .where("accountNumber", "==", accountNumber)
      .limit(1)
      .get();

    if (!duplicateSnap.empty) {
      return NextResponse.json(
        { error: "An account with this bank account number already exists" },
        { status: 409 },
      );
    }

    const newPerson: Omit<AccountPerson, 'id'> = {
      name,
      phone,
      email,
      accountNumber,
      ifscCode,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: uid,
      normalizedName: name.toLowerCase(),
      normalizedEmail: email,
      accountLast4: accountNumber.slice(-4),
      isActive: true,
    };

    const ref = await adminDb.collection("finance_external_accounts").add(newPerson);
    directoryCache = null;

    return NextResponse.json({ success: true, id: ref.id }, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
