import {
  KeyPairType,
  SessionRecordType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { openDB, DBSchema, IDBPDatabase } from "idb";

function isKeyPairType(k: unknown): k is KeyPairType {
  return typeof k === 'object' && k !== null && 'pubKey' in k;
}

interface SignalProtocolDB extends DBSchema {
  identityKeys: {
    key: string;
    value: ArrayBuffer | KeyPairType;
  };
  preKeys: {
    key: number;
    value: KeyPairType;
  };
  signedPreKeys: {
    key: number;
    value: KeyPairType;
  };
  sessions: {
    key: string; // "name.deviceId"
    value: SessionRecordType; // string
  };
  config: {
    key: string;
    value: unknown;
  };
}

export class SignalProtocolStore {
  private dbName = "signal_protocol_store";
  private db: IDBPDatabase<SignalProtocolDB> | null = null;

  constructor() {}

  async init() {
    this.db = await openDB<SignalProtocolDB>(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("identityKeys")) {
          db.createObjectStore("identityKeys");
        }
        if (!db.objectStoreNames.contains("preKeys")) {
          db.createObjectStore("preKeys");
        }
        if (!db.objectStoreNames.contains("signedPreKeys")) {
          db.createObjectStore("signedPreKeys");
        }
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions");
        }
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config");
        }
      },
    });
  }

  private getDb() {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  // --- IdentityKeyStore ---

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const kp = await this.getDb().get("identityKeys", "identityKey");
    return kp as KeyPairType | undefined;
  }

  async getLocalRegistrationId(): Promise<number> {
    const rid = await this.getDb().get("config", "registrationId");
    return rid as number;
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    // The identifier here is usually the remote address string
    // But SignalProtocolStore.saveIdentity usually means saving a TRUSTED remote identity
    await this.getDb().put("identityKeys", identityKey, identifier);
    return true;
  }

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: number
  ): Promise<boolean> {
    const existing = await this.getDb().get("identityKeys", identifier);
    if (!existing) {
      return true; // First time seeing this identity, trust it (TOFU)
    }
    
    // Check if existing is ArrayBuffer (remote) or KeyPairType (local - shouldn't happen for remote id)
    let existingBuffer: ArrayBuffer;
    if (isKeyPairType(existing)) {
        // It's a keypair, use pubKey
        existingBuffer = existing.pubKey;
    } else {
        existingBuffer = existing as ArrayBuffer;
    }
    
    // Compare ArrayBuffers
    const existingView = new Uint8Array(existingBuffer);
    const newView = new Uint8Array(identityKey);
    
    if (existingView.length !== newView.length) return false;
    for (let i = 0; i < existingView.length; i++) {
      if (existingView[i] !== newView[i]) return false;
    }
    
    return true;
  }

  async loadIdentityKey(identifier: string): Promise<ArrayBuffer | undefined> {
    const key = await this.getDb().get("identityKeys", identifier);
    if (!key) return undefined;
    if (isKeyPairType(key)) {
        return key.pubKey;
    }
    return key as ArrayBuffer;
  }

  // --- PreKeyStore ---

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    const res = await this.getDb().get("preKeys", id);
    return res;
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    await this.getDb().put("preKeys", keyPair, id);
  }

  async removePreKey(keyId: string | number): Promise<void> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    await this.getDb().delete("preKeys", id);
  }

  // --- SignedPreKeyStore ---

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    const res = await this.getDb().get("signedPreKeys", id);
    return res;
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    await this.getDb().put("signedPreKeys", keyPair, id);
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    const id = typeof keyId === 'string' ? parseInt(keyId) : keyId;
    await this.getDb().delete("signedPreKeys", id);
  }

  // --- SessionStore ---

  async loadSession(identifier: string): Promise<SessionRecordType | undefined> {
    const res = await this.getDb().get("sessions", identifier);
    return res;
  }

  async storeSession(identifier: string, record: SessionRecordType): Promise<void> {
    await this.getDb().put("sessions", record, identifier);
  }

  // --- Helpers for our app ---
  
  async storeLocalIdentityKeyPair(keyPair: KeyPairType): Promise<void> {
    await this.getDb().put("identityKeys", keyPair, "identityKey");
  }

  async storeLocalRegistrationId(registrationId: number): Promise<void> {
    await this.getDb().put("config", registrationId, "registrationId");
  }

  async clear(): Promise<void> {
      // For logout/debug
      if (this.db) {
          await this.db.clear('identityKeys');
          await this.db.clear('preKeys');
          await this.db.clear('signedPreKeys');
          await this.db.clear('sessions');
          await this.db.clear('config');
      }
  }

  async exportData(): Promise<Record<string, unknown>> {
    if (!this.db) throw new Error("Database not initialized");
    return {
        identityKeys: await this.db.getAll('identityKeys'),
        preKeys: await this.db.getAll('preKeys'),
        signedPreKeys: await this.db.getAll('signedPreKeys'),
        sessions: await this.db.getAll('sessions'),
        config: await this.db.getAll('config'),
        // We also need keys for restoring properly (specifically indices if they were used, but getAll returns values)
        // For simple restore, we might need more structure.
        // Actually, getAll returns values. But `put` needs keys. 
        // We should export as { key, value } pairs.
    };
  }

  async exportFullData(): Promise<Record<string, { key: string | number; value: unknown }[]>> {
      if (!this.db) throw new Error("DB not init");
      const stores = ['identityKeys', 'preKeys', 'signedPreKeys', 'sessions', 'config'] as const;
      const dump: Record<string, { key: string | number; value: unknown }[]> = {};
      
      for (const storeName of stores) {
          const keys = await this.db.getAllKeys(storeName);
          const values = await this.db.getAll(storeName);
          dump[storeName] = keys.map((k, i) => ({ key: k as string | number, value: values[i] }));
      }
      return dump;
  }

  async importFullData(dump: Record<string, { key: string | number; value: unknown }[]>): Promise<void> {
      if (!this.db) await this.init();
      if (!this.db) throw new Error("DB fail");

      const tx = this.db.transaction(['identityKeys', 'preKeys', 'signedPreKeys', 'sessions', 'config'], 'readwrite');
      const storeNames = ['identityKeys', 'preKeys', 'signedPreKeys', 'sessions', 'config'] as const;
      
      for (const storeName of Object.keys(dump)) {
          if ((storeNames as readonly string[]).includes(storeName)) {
              const store = tx.objectStore(storeName as typeof storeNames[number]);
              await store.clear();
              for (const item of dump[storeName]) {
                  await store.put(item.value, item.key);
              }
          }
      }
      await tx.done;
  }
}
