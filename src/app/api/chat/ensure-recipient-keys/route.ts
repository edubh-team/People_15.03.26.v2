import { generateKeyPairSync } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

function createEncryptionIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicExponent: 0x10001,
  });

  return {
    publicKey: JSON.stringify(publicKey.export({ format: "jwk" })),
    privateKey: JSON.stringify(privateKey.export({ format: "jwk" })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const verified = await verifyBearerRequest(request);
    if (!verified.ok) return verified.response;

    const body = (await request.json()) as {
      channelId?: unknown;
      recipientUids?: unknown;
    };
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
    const recipientUids = Array.isArray(body.recipientUids)
      ? Array.from(
          new Set(
            body.recipientUids.filter(
              (uid): uid is string => typeof uid === "string" && uid.trim().length > 0,
            ),
          ),
        )
      : [];

    if (!channelId || recipientUids.length === 0 || recipientUids.length > 50) {
      return NextResponse.json({ error: "Invalid channel or recipients." }, { status: 400 });
    }

    const { adminDb, uid: requesterUid } = verified.value;
    const channelSnap = await adminDb.collection("channels").doc(channelId).get();
    if (!channelSnap.exists) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }

    const participants = Array.isArray(channelSnap.data()?.participants)
      ? (channelSnap.data()?.participants as unknown[]).filter(
          (uid): uid is string => typeof uid === "string",
        )
      : [];
    if (
      !participants.includes(requesterUid) ||
      recipientUids.some((uid) => !participants.includes(uid))
    ) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const provisioned: string[] = [];
    await Promise.all(
      recipientUids.map(async (recipientUid) => {
        const userRef = adminDb.collection("users").doc(recipientUid);
        const backupRef = userRef.collection("private_data").doc("backup");

        await adminDb.runTransaction(async (transaction) => {
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists || userSnap.data()?.publicKey) return;

          const identity = createEncryptionIdentity();
          transaction.set(userRef, { publicKey: identity.publicKey }, { merge: true });
          transaction.set(
            backupRef,
            {
              privateKey: identity.privateKey,
              publicKey: identity.publicKey,
              updatedAt: new Date().toISOString(),
              provisionedForSecureChat: true,
            },
            { merge: true },
          );
          provisioned.push(recipientUid);
        });
      }),
    );

    return NextResponse.json({ ok: true, provisioned });
  } catch (error) {
    console.error("Unable to provision secure chat recipient keys:", error);
    return NextResponse.json(
      { error: "Unable to initialize recipient encryption." },
      { status: 500 },
    );
  }
}
