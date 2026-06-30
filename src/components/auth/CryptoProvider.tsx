
"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthProvider";
import { db } from "@/lib/firebase/client";
import { doc, updateDoc } from "firebase/firestore";
import { 
  generateIdentityKeyPair, 
  exportPublicKey, 
  exportPrivateKey, 
  importPrivateKey, 
  importPublicKey 
} from "@/lib/crypto";

interface CryptoContextType {
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  publicKeyBase64: string | null;
  isReady: boolean;
  regenerateKeys: () => Promise<void>;
}

const CryptoContext = createContext<CryptoContextType>({
  privateKey: null,
  publicKey: null,
  publicKeyBase64: null,
  isReady: false,
  regenerateKeys: async () => {},
});

export const useCrypto = () => useContext(CryptoContext);

const LOCAL_STORAGE_KEY_PREFIX = "edubh_chat_priv_key_";

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, userDoc } = useAuth();
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [publicKeyBase64, setPublicKeyBase64] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const generateAndSaveKeys = useCallback(async (uid: string) => {
    try {
      console.log("Generating new identity keys...");
      const pair = await generateIdentityKeyPair();
      const pubBase64 = await exportPublicKey(pair.publicKey);
      const privBase64 = await exportPrivateKey(pair.privateKey);

      // Save to LocalStorage
      window.localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + uid, privBase64);

      // Save Public Key to Firestore
      if (db) {
        await updateDoc(doc(db, "users", uid), {
          "keys.publicKey": pubBase64
        });
      }

      setPrivateKey(pair.privateKey);
      setPublicKey(pair.publicKey);
      setPublicKeyBase64(pubBase64);
      setIsReady(true);
    } catch (e) {
      console.error("Error generating keys:", e);
    }
  }, []);

  useEffect(() => {
    async function initKeys() {
      if (!firebaseUser || !userDoc) {
        setPrivateKey(null);
        setPublicKey(null);
        setIsReady(false);
        return;
      }

      const uid = firebaseUser.uid;
      const storedPrivKey = window.localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + uid);
      const remotePubKey = userDoc.keys?.publicKey;

      // Case 1: Everything exists and matches (Optimistic)
      if (storedPrivKey && remotePubKey) {
        try {
          const priv = await importPrivateKey(storedPrivKey);
          const pub = await importPublicKey(remotePubKey);
          
          setPrivateKey(priv);
          setPublicKey(pub);
          setPublicKeyBase64(remotePubKey);
          setIsReady(true);
          return;
        } catch (e) {
          console.error("Failed to load existing keys, resetting...", e);
        }
      }

      // Case 2: No keys anywhere (New User) or mismatch
      // For MVP: If we lack the private key, we MUST regenerate to be able to decrypt future messages.
      // (Real app would prompt for password to decrypt a remote backup)
      await generateAndSaveKeys(uid);
    }

    initKeys();
  }, [firebaseUser, userDoc?.keys?.publicKey, generateAndSaveKeys]);

  return (
    <CryptoContext.Provider value={{ privateKey, publicKey, publicKeyBase64, isReady, regenerateKeys: async () => {
      if (firebaseUser) await generateAndSaveKeys(firebaseUser.uid);
    }}}>
      {children}
    </CryptoContext.Provider>
  );
}
