import { db } from "@/lib/firebase/client";
import { doc, getDoc, setDoc, updateDoc, arrayRemove } from "firebase/firestore";

export interface PublicPreKeyBundle {
  identityKey: string; // Base64
  registrationId: number;
  signedPreKey: {
    keyId: number;
    publicKey: string; // Base64
    signature: string; // Base64
  };
  oneTimePreKey?: {
    keyId: number;
    publicKey: string; // Base64
  };
}

export class KeyService {
  private static COLLECTION = "key_registry";

  static async uploadKeys(uid: string, data: {
    identityKey: string;
    registrationId: number;
    signedPreKey: {
      keyId: number;
      publicKey: string;
      signature: string;
    };
    oneTimePreKeys: Array<{
      keyId: number;
      publicKey: string;
    }>;
  }) {
    if (!db) throw new Error("Firestore not initialized");
    await setDoc(doc(db, this.COLLECTION, uid), data);
  }

  static async hasKeys(uid: string): Promise<boolean> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, this.COLLECTION, uid);
    const snap = await getDoc(docRef);
    return snap.exists();
  }

  static async getPreKeyBundle(uid: string): Promise<PublicPreKeyBundle | null> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, this.COLLECTION, uid);
    const snap = await getDoc(docRef);

    if (!snap.exists()) return null;
    const data = snap.data();

    // Pick one OTPK if available
    let oneTimePreKey = undefined;
    if (data.oneTimePreKeys && data.oneTimePreKeys.length > 0) {
      oneTimePreKey = data.oneTimePreKeys[0];
      
      // Optimistically remove it from server (server function usually does this better for atomicity, but client can try)
      // Note: In a real prod env, fetching a key should be an atomic Cloud Function to prevent reuse.
      // For this implementation, we will assume the client claims it. 
      // Race conditions are possible here without a backend function.
      try {
          await updateDoc(docRef, {
              oneTimePreKeys: arrayRemove(oneTimePreKey)
          });
      } catch (e) {
          console.warn("Failed to remove OTPK, might be claimed by another", e);
      }
    }

    return {
      identityKey: data.identityKey,
      registrationId: data.registrationId,
      signedPreKey: data.signedPreKey,
      oneTimePreKey
    };
  }
}
