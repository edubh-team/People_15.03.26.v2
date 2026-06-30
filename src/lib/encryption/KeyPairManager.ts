import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { db } from '@/lib/firebase/client';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface SecureChatDB extends DBSchema {
  keys: {
    key: string;
    value: CryptoKeyPair | CryptoKey;
  };
}

const DB_NAME = 'secure_chat_db';
const STORE_NAME = 'keys';
const PRIVATE_KEY_ID = 'private_identity_key';
const PUBLIC_KEY_ID = 'public_identity_key';

export class KeyPairManager {
  private static instance: KeyPairManager;
  private dbPromise: Promise<IDBPDatabase<SecureChatDB>>;
  private memoryKeyPair: CryptoKeyPair | null = null;
  private publicKeyCache: Map<string, CryptoKey> = new Map();

  private constructor() {
    this.dbPromise = openDB<SecureChatDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME);
      },
    });
  }

  static getInstance(): KeyPairManager {
    if (!KeyPairManager.instance) {
      KeyPairManager.instance = new KeyPairManager();
    }
    return KeyPairManager.instance;
  }

  // --- Core Lifecycle Methods ---

  async getLocalKeyPair(): Promise<CryptoKeyPair | null> {
    // 1. Check Memory
    if (this.memoryKeyPair) return this.memoryKeyPair;

    // 2. Check IndexedDB
    const db = await this.dbPromise;
    const privateKey = await db.get(STORE_NAME, PRIVATE_KEY_ID) as CryptoKey;
    const publicKey = await db.get(STORE_NAME, PUBLIC_KEY_ID) as CryptoKey;

    if (privateKey && publicKey) {
      this.memoryKeyPair = { privateKey, publicKey };
      return this.memoryKeyPair;
    }
    
    return null;
  }

  async ensureKeyPairExists(userId: string): Promise<CryptoKeyPair> {
    // 1. Try Local
    const existing = await this.getLocalKeyPair();
    if (existing) {
        await this.verifyAndPublishPublicKey(userId, existing.publicKey);
        return existing;
    }

    // 2. Try Restore from Backup
    const restored = await this.restoreKeyPairFromBackup(userId);
    if (restored) {
        console.log("Key Pair restored from cloud backup.");
        return restored;
    }

    // 3. Generate New
    console.log("No key found locally or in backup. Generating new identity...");
    return await this.generateAndPublishKeyPair(userId);
  }

  async generateAndPublishKeyPair(userId: string): Promise<CryptoKeyPair> {
    console.log("Generating new RSA-OAEP-4096 Key Pair...");

    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Secure Context Required: Cryptography API is unavailable. Please ensure you are using HTTPS or localhost.");
    }

    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true, // extractable: true (REQUIRED FOR BACKUP)
      ["encrypt", "decrypt"]
    );

    await this.saveIdentity(userId, keyPair);
    return keyPair;
  }

  private async saveIdentity(
      userId: string, 
      keyPair: CryptoKeyPair
  ) {
    // 1. Store Locally (IDB)
    const idb = await this.dbPromise;
    await idb.put(STORE_NAME, keyPair.privateKey, PRIVATE_KEY_ID);
    await idb.put(STORE_NAME, keyPair.publicKey, PUBLIC_KEY_ID);
    
    // 2. Update Memory
    this.memoryKeyPair = keyPair;

    if (!db) throw new Error("Firestore not initialized");

    // 3. Export Keys
    const exportedPublicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const exportedPrivateKey = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

    const publicKeyStr = JSON.stringify(exportedPublicKey);
    const privateKeyStr = JSON.stringify(exportedPrivateKey);

    // 4. Publish Public Key (Visible to all)
    await setDoc(doc(db, "users", userId), {
      publicKey: publicKeyStr
    }, { merge: true });

    // 5. Backup Private Key (Secure Subcollection)
    // NOTE: Requires firestore.rules to restrict access to 'private_data' subcollection
    await setDoc(doc(db, "users", userId, "private_data", "backup"), {
      privateKey: privateKeyStr,
      publicKey: publicKeyStr, // Backup public key too just in case
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log("Identity saved and synced to cloud (with secure backup).");
  }

  private async restoreKeyPairFromBackup(userId: string): Promise<CryptoKeyPair | null> {
    if (!db) return null;
    try {
        const backupRef = doc(db, "users", userId, "private_data", "backup");
        const snap = await getDoc(backupRef);

        if (!snap.exists()) return null;

        const data = snap.data();
        if (!data.privateKey || !data.publicKey) return null;

        const privateKeyJwk = JSON.parse(data.privateKey);
        const publicKeyJwk = JSON.parse(data.publicKey);

        const privateKey = await window.crypto.subtle.importKey(
            "jwk",
            privateKeyJwk,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );

        const publicKey = await window.crypto.subtle.importKey(
            "jwk",
            publicKeyJwk,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );

        const keyPair = { privateKey, publicKey };

        // Save restored keys locally
        const idb = await this.dbPromise;
        await idb.put(STORE_NAME, privateKey, PRIVATE_KEY_ID);
        await idb.put(STORE_NAME, publicKey, PUBLIC_KEY_ID);
        this.memoryKeyPair = keyPair;

        return keyPair;
    } catch (e) {
        console.error("Failed to restore key pair from backup:", e);
        return null;
    }
  }

  // --- Existing Helper Methods ---

  private async verifyAndPublishPublicKey(userId: string, publicKey: CryptoKey): Promise<void> {
      if (!db) return; 
      
      try {
          const exportedLocal = await window.crypto.subtle.exportKey("jwk", publicKey);
          const localJwkStr = JSON.stringify(exportedLocal);

          const userDocRef = doc(db, "users", userId);
          const snap = await getDoc(userDocRef);
          
          let needsUpload = true;

          if (snap.exists()) {
              const remoteJwkStr = snap.data().publicKey;
              if (remoteJwkStr === localJwkStr) {
                  needsUpload = false;
              } else {
                  console.warn("Public Key Mismatch detected. Repairing Firestore...");
              }
          } else {
              console.warn("No Public Key in Firestore. Uploading...");
          }

          if (needsUpload) {
              await setDoc(userDocRef, {
                  publicKey: localJwkStr
              }, { merge: true });
              console.log("Public Key repaired/uploaded to Firestore.");
          }
      } catch (e) {
          console.error("Failed to verify/upload public key:", e);
      }
  }

  async getUserPublicKey(userId: string): Promise<CryptoKey | null> {
    if (this.publicKeyCache.has(userId)) {
      return this.publicKeyCache.get(userId)!;
    }

    if (!db) throw new Error("Firestore not initialized");
    const snap = await getDoc(doc(db, "users", userId));
    const data = snap.exists() ? snap.data() : null;
    const rawPublicKey = data?.publicKey ?? data?.keys?.publicKey ?? null;
    if (!rawPublicKey) {
      console.warn(`User ${userId} has no public key.`);
      return null;
    }

    try {
      const jwk = JSON.parse(rawPublicKey);
      const key = await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
          name: "RSA-OAEP",
          hash: "SHA-256"
        },
        true,
        ["encrypt"]
      );
      this.publicKeyCache.set(userId, key);
      return key;
    } catch (e) {
      console.error(`Failed to import public key for ${userId}`, e);
      return null;
    }
  }
}
