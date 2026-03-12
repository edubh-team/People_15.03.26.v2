import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type AuthLogDoc = {
  uid: string;
  email: string | null;
  provider: string;
  event: "login";
  createdAt: unknown;
};

export async function logLoginEvent(input: {
  uid: string;
  email: string | null;
  provider: string;
}) {
  if (!db) throw new Error("Firebase is not configured");
  await addDoc(collection(db, "authLogs"), {
    uid: input.uid,
    email: input.email,
    provider: input.provider,
    event: "login",
    createdAt: serverTimestamp(),
  } satisfies AuthLogDoc);
}

