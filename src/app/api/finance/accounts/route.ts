import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { buildFinanceAccountDirectory, normalizeAccountNumber, normalizeIfscCode, normalizePhone } from "@/lib/finance/accountDirectory";
import { requireFinanceRequestUser } from "@/lib/server/request-auth";
import { type AccountPerson, type FinanceAccountDirectoryResponse } from "@/lib/types/finance";
import type { UserDoc } from "@/lib/types/user";

export const runtime = "nodejs";

function noStoreJson(body: FinanceAccountDirectoryResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const verified = await requireFinanceRequestUser(req);
  if (!verified.ok) return verified.response;

  const { adminDb } = verified.value;

  try {
    const [usersSnap, externalSnap] = await Promise.all([
      adminDb.collection("users").get(),
      adminDb.collection("finance_external_accounts").get(),
    ]);

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

    return noStoreJson(directory);
  } catch (err: any) {
    console.error("Finance account directory error:", err);
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

    return NextResponse.json({ success: true, id: ref.id }, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
