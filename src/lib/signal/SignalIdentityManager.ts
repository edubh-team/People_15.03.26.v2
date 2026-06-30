import {
  KeyHelper,
} from "@privacyresearch/libsignal-protocol-typescript";
import { SignalProtocolStore } from "./store/SignalProtocolStore";
import { db } from "@/lib/firebase/client";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { arrayBufferToBase64 } from "@/lib/crypto";

export interface PublicBundle {
  registrationId: number;
  identityKey: string; // Base64 (Public)
  signedPreKey: {
    keyId: number;
    publicKey: string; // Base64
    signature: string; // Base64
  };
  oneTimePreKeys: Array<{
    keyId: number;
    publicKey: string; // Base64
  }>;
  updatedAt: unknown; // Timestamp
}

export class SignalIdentityManager {
  private static instance: SignalIdentityManager;
  private store: SignalProtocolStore;

  private constructor() {
    this.store = new SignalProtocolStore();
  }

  static getInstance(): SignalIdentityManager {
    if (!SignalIdentityManager.instance) {
      SignalIdentityManager.instance = new SignalIdentityManager();
    }
    return SignalIdentityManager.instance;
  }

  /**
   * Ensures that the current user has a valid Signal Identity (Identity Key + Registration ID).
   * Checks local IndexedDB first, then validates/publishes against Firestore.
   */
  async ensureIdentityExists(userId: string): Promise<void> {
    if (!db) throw new Error("Firebase is not initialized");

    // 0. Initialize Store
    await this.store.init();

    // 1. Local Check
    let identityKeyPair = await this.store.getIdentityKeyPair();
    let registrationId = await this.store.getLocalRegistrationId();

    if (!identityKeyPair || !registrationId) {
      console.log("[SignalIdentityManager] Local identity missing. Generating new identity...");
      registrationId = KeyHelper.generateRegistrationId();
      identityKeyPair = await KeyHelper.generateIdentityKeyPair();

      await this.store.storeLocalRegistrationId(registrationId);
      await this.store.storeLocalIdentityKeyPair(identityKeyPair);
    }

    // 2. Server Check (The Migration Logic)
    const bundleRef = doc(db, "users", userId, "security_keys", "public_bundle");
    const bundleSnap = await getDoc(bundleRef);

    if (bundleSnap.exists()) {
      console.log("[SignalIdentityManager] Identity exists on server. Security setup complete.");
      return;
    }

    console.log("[SignalIdentityManager] Server identity missing. Publishing keys...");

    // 3. Generate Pre-Keys for Publishing
    
    // Signed Pre-Key
    const signedPreKeyId = 1;
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
    await this.store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

    // One-Time Pre-Keys (Batch of 100)
    const oneTimePreKeys: Array<{ keyId: number; publicKey: string }> = [];
    const startId = 10; // Start ID for OTPKs
    
    for (let i = 0; i < 100; i++) {
      const keyId = startId + i;
      const preKey = await KeyHelper.generatePreKey(keyId);
      await this.store.storePreKey(keyId, preKey.keyPair);
      
      oneTimePreKeys.push({
        keyId,
        publicKey: arrayBufferToBase64(preKey.keyPair.pubKey),
      });
    }

    // 4. Construct Public Bundle
    const publicBundle: PublicBundle = {
      registrationId,
      identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signature: arrayBufferToBase64(signedPreKey.signature),
      },
      oneTimePreKeys,
      updatedAt: serverTimestamp(),
    };

    // 5. Upload to Firestore
    await setDoc(bundleRef, publicBundle);
    console.log("[SignalIdentityManager] Keys published successfully.");
  }
}
