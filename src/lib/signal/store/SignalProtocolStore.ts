import {
  KeyPairType,
  Direction,
} from "@privacyresearch/libsignal-protocol-typescript";
import { openDB, DBSchema, IDBPDatabase } from "idb";

// Type guards
function isKeyPairType(k: unknown): k is KeyPairType {
  return typeof k === 'object' && k !== null && 'pubKey' in k && 'privKey' in k;
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
    value: string; // Serialized session record
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

  async getLocalRegistrationId(): Promise<number | undefined> {
    const rid = await this.getDb().get("config", "registrationId");
    return rid as number | undefined;
  }

  async storeLocalRegistrationId(registrationId: number): Promise<void> {
      await this.getDb().put("config", registrationId, "registrationId");
  }

  async storeLocalIdentityKeyPair(identityKeyPair: KeyPairType): Promise<void> {
      await this.getDb().put("identityKeys", identityKeyPair, "identityKey");
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    // identifier is usually "userid.deviceId"
    await this.getDb().put("identityKeys", identityKey, identifier);
    return true;
  }

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction
  ): Promise<boolean> {
    const existing = await this.getDb().get("identityKeys", identifier);
    if (!existing) {
      return true; // First time seeing this identity, trust it (TOFU)
    }
    
    let existingBuffer: ArrayBuffer;
    if (isKeyPairType(existing)) {
        // It's a keypair, use pubKey
        existingBuffer = existing.pubKey;
    } else {
        existingBuffer = existing as ArrayBuffer;
    }

    // Compare buffers
    const existingArr = new Uint8Array(existingBuffer);
    const newArr = new Uint8Array(identityKey);
    
    if (existingArr.length !== newArr.length) return false;
    for (let i = 0; i < existingArr.length; i++) {
        if (existingArr[i] !== newArr[i]) return false;
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

  // --- SessionStore ---

  async loadSession(identifier: string): Promise<string | undefined> {
    return await this.getDb().get("sessions", identifier);
  }

  async storeSession(identifier: string, record: string): Promise<void> {
    await this.getDb().put("sessions", record, identifier);
  }

  // --- PreKeyStore ---

  async loadPreKey(keyId: number): Promise<KeyPairType | undefined> {
    return await this.getDb().get("preKeys", keyId);
  }

  async storePreKey(keyId: number, keyPair: KeyPairType): Promise<void> {
    await this.getDb().put("preKeys", keyPair, keyId);
  }

  async removePreKey(keyId: number): Promise<void> {
    await this.getDb().delete("preKeys", keyId);
  }

  // --- SignedPreKeyStore ---

  async loadSignedPreKey(keyId: number): Promise<KeyPairType | undefined> {
    return await this.getDb().get("signedPreKeys", keyId);
  }

  async storeSignedPreKey(keyId: number, keyPair: KeyPairType): Promise<void> {
    await this.getDb().put("signedPreKeys", keyPair, keyId);
  }

  async removeSignedPreKey(keyId: number): Promise<void> {
    await this.getDb().delete("signedPreKeys", keyId);
  }
}
