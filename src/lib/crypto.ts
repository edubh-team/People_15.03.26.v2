
// Basic ArrayBuffer to Base64 and vice versa
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Identity Keys (RSA-OAEP) ---

export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  return arrayBufferToBase64(exported);
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("pkcs8", key);
  return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64);
  return window.crypto.subtle.importKey(
    "spki",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

export async function importPrivateKey(base64: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64);
  return window.crypto.subtle.importKey(
    "pkcs8",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

// --- Session Keys (AES-GCM) ---

export async function generateSessionKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportSessionKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
}

export async function importSessionKey(base64: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64);
  return window.crypto.subtle.importKey(
    "raw",
    buffer,
    {
        name: "AES-GCM",
        length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

// --- Key Distribution (RSA Encrypt/Decrypt of AES Key) ---

export async function encryptSessionKeyForUser(sessionKey: CryptoKey, userPublicKey: CryptoKey): Promise<string> {
  // Export session key to raw bytes
  const sessionKeyRaw = await window.crypto.subtle.exportKey("raw", sessionKey);
  
  // Encrypt the raw bytes with the user's public RSA key
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "RSA-OAEP"
    },
    userPublicKey,
    sessionKeyRaw
  );
  
  return arrayBufferToBase64(encrypted);
}

export async function decryptSessionKey(encryptedSessionKeyBase64: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const encryptedBuffer = base64ToArrayBuffer(encryptedSessionKeyBase64);
  
  // Decrypt to get raw session key bytes
  const decryptedRaw = await window.crypto.subtle.decrypt(
    {
      name: "RSA-OAEP"
    },
    privateKey,
    encryptedBuffer
  );
  
  // Import the raw bytes back as an AES-GCM key
  return window.crypto.subtle.importKey(
    "raw",
    decryptedRaw,
    {
        name: "AES-GCM",
        length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

// --- Message Encryption (AES-GCM) ---

export type EncryptedMessage = {
  ciphertext: string; // Base64
  iv: string; // Base64
};

export async function encryptMessage(text: string, sessionKey: CryptoKey): Promise<EncryptedMessage> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  
  // IV must be unique for every encryption
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sessionKey,
    data
  );
  
  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer)
  };
}

export async function decryptMessage(ciphertext: string, iv: string, sessionKey: CryptoKey): Promise<string | null> {
  const encryptedBuffer = base64ToArrayBuffer(ciphertext);
  const ivBuffer = base64ToArrayBuffer(iv);
  
  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer
      },
      sessionKey,
      encryptedBuffer
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch {
    // Suppress noisy console errors for expected failures (e.g. key rotation/mismatch)
    // Only log if strictly necessary for debugging
    // console.warn("Decryption attempt failed:", e);
    return null;
  }
}

// --- PBKDF2 & Backup Encryption ---

export async function deriveKeyFromPin(pin: string, salt: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(salt),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function encryptBlob(data: string, key: CryptoKey): Promise<{ ciphertext: string, iv: string }> {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv
        },
        key,
        enc.encode(data)
    );

    return {
        ciphertext: arrayBufferToBase64(encrypted),
        iv: arrayBufferToBase64(iv.buffer as ArrayBuffer)
    };
}

export async function decryptBlob(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
    const decrypted = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: base64ToArrayBuffer(iv)
        },
        key,
        base64ToArrayBuffer(ciphertext)
    );
    return new TextDecoder().decode(decrypted);
}
