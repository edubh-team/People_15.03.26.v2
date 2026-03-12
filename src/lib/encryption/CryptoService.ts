import { KeyPairManager } from './KeyPairManager';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/lib/crypto';

export interface EnvelopeMessage {
  encryptedContent: string;
  iv: string;
  recipientKeys: Record<string, string>; // uid -> encrypted AES key (Base64)
}

export interface EncryptedPrivateKey {
  encryptedData: string; // Base64
  salt: string; // Base64
  iv: string; // Base64
}

export class CryptoService {
  private static instance: CryptoService;

  private constructor() {}

  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  // --- Key Wrapping & Unwrapping (PBKDF2 + AES-GCM) ---

  async deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt as unknown as BufferSource,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async encryptPrivateKey(privateKey: CryptoKey, password: string): Promise<EncryptedPrivateKey> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const keyWrapper = await this.deriveKeyFromPassword(password, salt);

    // Export Private Key to PKCS8
    const exportedKey = await window.crypto.subtle.exportKey("pkcs8", privateKey);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      keyWrapper,
      exportedKey
    );

    return {
      encryptedData: arrayBufferToBase64(encryptedBuffer),
      salt: arrayBufferToBase64(salt.buffer),
      iv: arrayBufferToBase64(iv.buffer),
    };
  }

  async decryptPrivateKey(encryptedKey: EncryptedPrivateKey, password: string): Promise<CryptoKey> {
    const salt = base64ToArrayBuffer(encryptedKey.salt);
    const iv = base64ToArrayBuffer(encryptedKey.iv);
    const encryptedData = base64ToArrayBuffer(encryptedKey.encryptedData);

    const keyWrapper = await this.deriveKeyFromPassword(password, new Uint8Array(salt));

    try {
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        keyWrapper,
        encryptedData
      );

      return window.crypto.subtle.importKey(
        "pkcs8",
        decryptedBuffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, // non-extractable
        ["decrypt"]
      );
    } catch (e) {
      console.error("Failed to decrypt private key. Wrong password?", e);
      throw new Error("WRONG_PASSWORD");
    }
  }

  async encryptMessage(text: string, recipientIds: string[]): Promise<EnvelopeMessage> {
    const keyManager = KeyPairManager.getInstance();
    
    // 1. Generate Ephemeral AES-256-GCM Key
    const aesKey = await window.crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );

    // 2. Generate IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // 3. Encrypt Content
    const encodedText = new TextEncoder().encode(text);
    const encryptedContentBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      aesKey,
      encodedText
    );

    // 4. Encrypt AES Key for each recipient
    const recipientKeys: Record<string, string> = {};
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

    for (const uid of recipientIds) {
      const pubKey = await keyManager.getUserPublicKey(uid);
      if (!pubKey) {
        console.warn(`Skipping encryption for ${uid}: No Public Key found.`);
        continue;
      }

      const encryptedAesKeyBuffer = await window.crypto.subtle.encrypt(
        {
          name: "RSA-OAEP",
        },
        pubKey,
        rawAesKey
      );

      recipientKeys[uid] = arrayBufferToBase64(encryptedAesKeyBuffer);
    }

    if (Object.keys(recipientKeys).length === 0) {
        throw new Error("Could not encrypt for any recipients (No public keys found).");
    }

    return {
      encryptedContent: arrayBufferToBase64(encryptedContentBuffer),
      iv: arrayBufferToBase64(iv.buffer),
      recipientKeys
    };
  }

  async decryptMessage(
    currentUserId: string,
    message: EnvelopeMessage
  ): Promise<string> {
    // 1. Get My Private Key
    const keyPair = await KeyPairManager.getInstance().getLocalKeyPair();
    if (!keyPair) {
      throw new Error("No private key found for current user.");
    }

    // 2. Find my encrypted AES key
    const myEncryptedKeyBase64 = message.recipientKeys[currentUserId];
    if (!myEncryptedKeyBase64) {
      throw new Error("You are not a recipient of this message.");
    }

    try {
      // 3. Decrypt AES Key
      const encryptedAesKey = base64ToArrayBuffer(myEncryptedKeyBase64);
      let rawAesKey: ArrayBuffer;
      
      try {
          rawAesKey = await window.crypto.subtle.decrypt(
            {
              name: "RSA-OAEP",
            },
            keyPair.privateKey,
            encryptedAesKey
          );
      } catch (keyErr) {
          // Log as warning only, since this is expected during key rotation/resets
          console.warn("RSA Decryption failed (Key Mismatch?):", keyErr);
          throw new Error("DECRYPTION_FAILED_KEY_MISMATCH");
      }

      // 4. Import AES Key
      const aesKey = await window.crypto.subtle.importKey(
        "raw",
        rawAesKey,
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["decrypt"]
      );

      // 5. Decrypt Content
      const iv = base64ToArrayBuffer(message.iv);
      const encryptedContent = base64ToArrayBuffer(message.encryptedContent);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        aesKey,
        encryptedContent
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "DECRYPTION_FAILED_KEY_MISMATCH") {
          throw e;
      }
      console.error("Decryption failed:", e);
      throw new Error("Decryption failed (Invalid Key or Corrupted Data)");
    }
  }
}
