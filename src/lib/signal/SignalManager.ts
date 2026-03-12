import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  MessageType,
  DeviceType
} from "@privacyresearch/libsignal-protocol-typescript";
import { SignalProtocolStore } from "./SignalProtocolStore";
import { KeyService } from "./KeyService";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/lib/crypto";

export class SignalManager {
  private static instance: SignalManager;
  private store: SignalProtocolStore;
  private currentUserId: string | null = null;
  private registrationId: number = 0;

  private constructor() {
    this.store = new SignalProtocolStore();
  }

  static getInstance(): SignalManager {
    if (!SignalManager.instance) {
      SignalManager.instance = new SignalManager();
    }
    return SignalManager.instance;
  }

  async initialize(userId: string): Promise<void> {
    if (this.currentUserId === userId) return;
    this.currentUserId = userId;
    
    await this.store.init();

    let identityKeyPair = await this.store.getIdentityKeyPair();
    let registrationId = await this.store.getLocalRegistrationId();
    const hasRemoteKeys = await KeyService.hasKeys(userId);

    if (!identityKeyPair || !registrationId || !hasRemoteKeys) {
      console.log("Generating new Signal Identity Keys (Local or Remote missing)...");
      registrationId = KeyHelper.generateRegistrationId();
      identityKeyPair = await KeyHelper.generateIdentityKeyPair();
      
      await this.store.storeLocalIdentityKeyPair(identityKeyPair);
      await this.store.storeLocalRegistrationId(registrationId);

      // Generate Pre-Keys
      const preKeyId = 1;
      const preKey = await KeyHelper.generatePreKey(preKeyId);
      await this.store.storePreKey(preKeyId, preKey.keyPair);

      const signedPreKeyId = 1;
      const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
      await this.store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

      // Generate One-Time Pre-Keys (Batch of 100)
      const oneTimePreKeys = [];
      for (let i = 0; i < 100; i++) {
        const keyId = i + 10; // Start offset to avoid conflict
        const key = await KeyHelper.generatePreKey(keyId);
        await this.store.storePreKey(keyId, key.keyPair);
        oneTimePreKeys.push({
            keyId,
            publicKey: arrayBufferToBase64(key.keyPair.pubKey)
        });
      }

      // Upload to Firestore
      await KeyService.uploadKeys(userId, {
        identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
        registrationId,
        signedPreKey: {
          keyId: signedPreKeyId,
          publicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
          signature: arrayBufferToBase64(signedPreKey.signature),
        },
        oneTimePreKeys
      });
    }

    this.registrationId = registrationId;
  }

  async encryptMessage(recipientId: string, plaintext: string, deviceId: number = 1): Promise<MessageType & { registrationId: number }> {
    if (!this.currentUserId) throw new Error("SignalManager not initialized");

    // Special handling for Self-Encryption (Sync to same device)
    // Signal Protocol doesn't support sending to self on same address (SenderChain vs ReceiverChain conflict)
    if (recipientId === this.currentUserId && deviceId === 1) {
        return this.encryptForSelf(plaintext);
    }

    const address = new SignalProtocolAddress(recipientId, deviceId);
    const sessionCipher = new SessionCipher(this.store, address);

    // Check if we have a session
    if (!(await this.store.loadSession(address.toString()))) {
      console.log(`No session for ${recipientId}, fetching keys...`);
      // Fetch PreKeyBundle
      const bundle = await KeyService.getPreKeyBundle(recipientId);
      if (!bundle) {
        throw new Error(`User ${recipientId} has no keys setup.`);
      }

      const builder = new SessionBuilder(this.store, address);
      const preKeyBundle: DeviceType = {
        registrationId: bundle.registrationId,
        identityKey: base64ToArrayBuffer(bundle.identityKey),
        signedPreKey: {
          keyId: bundle.signedPreKey.keyId,
          publicKey: base64ToArrayBuffer(bundle.signedPreKey.publicKey),
          signature: base64ToArrayBuffer(bundle.signedPreKey.signature),
        },
        preKey: bundle.oneTimePreKey ? {
          keyId: bundle.oneTimePreKey.keyId,
          publicKey: base64ToArrayBuffer(bundle.oneTimePreKey.publicKey),
        } : undefined,
      };
      await builder.processPreKey(preKeyBundle);
      console.log(`Session established with ${recipientId}`);
    }

    const ciphertext: MessageType = await sessionCipher.encrypt(
      new TextEncoder().encode(plaintext).buffer
    );

    // Convert binary string to Base64 manually via Uint8Array to prevent encoding corruption
    // LibSignal returns a "binary string" where each char is a byte (0-255).
    // We must preserve these exact bytes when moving to Base64.
    if (!ciphertext.body) {
        throw new Error("Encryption failed: No ciphertext body produced.");
    }
    const bytes = new Uint8Array(ciphertext.body.length);
    for (let i = 0; i < ciphertext.body.length; i++) {
        bytes[i] = ciphertext.body.charCodeAt(i);
    }
    const bodyBase64 = arrayBufferToBase64(bytes.buffer);

    return {
      type: ciphertext.type,
      body: bodyBase64,
      registrationId: this.registrationId
    };
  }

  async encryptGroupMessage(recipientIds: string[], plaintext: string): Promise<Record<string, MessageType & { registrationId: number }>> {
      const result: Record<string, MessageType & { registrationId: number }> = {};
      
      for (const uid of recipientIds) {
          // Encrypt for everyone, including self (for device sync)
          try {
              result[uid] = await this.encryptMessage(uid, plaintext);
          } catch (e) {
              console.error(`Failed to encrypt for ${uid}`, e);
              // We don't fail the whole batch, just this user
          }
      }
      return result;
  }

  async decryptMessage(senderId: string, ciphertext: string, type: number): Promise<string | { error: string }> {
    if (!this.currentUserId) throw new Error("SignalManager not initialized");

    // Handle Self-Encrypted Messages
    if (type === 99) {
        try {
            return await this.decryptForSelf(ciphertext);
        } catch (e) {
            console.error("Self-Decryption failed:", e);
            return { error: "SELF_DECRYPTION_FAILED" };
        }
    }

    const address = new SignalProtocolAddress(senderId, 1);
    const sessionCipher = new SessionCipher(this.store, address);

    let plaintextBuffer: ArrayBuffer;
    
    try {
        // Convert Base64 back to Binary String safely
        let binaryCiphertext = "";
        try {
            const buffer = base64ToArrayBuffer(ciphertext);
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i++) {
                binaryCiphertext += String.fromCharCode(bytes[i]);
            }
        } catch (decodingError) {
             console.warn("Base64 decode failed, assuming legacy raw string", decodingError);
             binaryCiphertext = ciphertext;
        }

        if (type === 3) { // PreKeyWhisperMessage (Initial)
            plaintextBuffer = await sessionCipher.decryptPreKeyWhisperMessage(binaryCiphertext, "binary");
        } else { // WhisperMessage (Standard)
            plaintextBuffer = await sessionCipher.decryptWhisperMessage(binaryCiphertext, "binary");
        }
        return new TextDecoder().decode(plaintextBuffer);
    } catch (e: unknown) {
        console.error("Signal Decrypt Error:", e);
        if (e instanceof Error && (e.message?.includes("Message key not found") || e.message?.includes("No session"))) {
             return { error: "DECRYPTION_FAILED_SESSION_RESET_NEEDED" };
        }
        return { error: "DECRYPTION_FAILED" };
    }
  }
  
  async clear() {
      await this.store.clear();
      this.currentUserId = null;
  }

  async exportData(): Promise<Record<string, unknown>> {
      return this.store.exportFullData();
  }

  async importData(data: Record<string, { key: string | number; value: unknown }[]>) {
      await this.store.importFullData(data);
  }

  // --- Self Encryption Helpers ---

  private async getSelfEncryptionKey(): Promise<CryptoKey> {
    const kp = await this.store.getIdentityKeyPair();
    if (!kp) throw new Error("Identity Key not found");

    // Use Private Key as material for PBKDF2
    const material = kp.privKey; 

    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      material,
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("SIGNAL_SELF_ENCRYPTION_SALT"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private async encryptForSelf(plaintext: string): Promise<MessageType & { registrationId: number }> {
    const key = await this.getSelfEncryptionKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    // Format: IV + Ciphertext (concatenated)
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return {
      type: 99, // Custom type for Self
      body: arrayBufferToBase64(combined.buffer as ArrayBuffer),
      registrationId: this.registrationId
    };
  }

  private async decryptForSelf(ciphertextBase64: string): Promise<string> {
    const key = await this.getSelfEncryptionKey();
    const combined = base64ToArrayBuffer(ciphertextBase64);
    
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    return new TextDecoder().decode(decrypted);
  }
}
