import { db } from "@/lib/firebase/client";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { SignalManager } from "./SignalManager";
import { deriveKeyFromPin, encryptBlob, decryptBlob } from "@/lib/crypto";

export class BackupService {
    static async createBackup(userId: string, pin: string): Promise<void> {
        // 1. Export Data
        const dump = await SignalManager.getInstance().exportData();
        const json = JSON.stringify(dump);

        // 2. Encrypt
        const salt = window.crypto.randomUUID(); // Simple salt
        const key = await deriveKeyFromPin(pin, salt);
        const { ciphertext, iv } = await encryptBlob(json, key);

        // 3. Upload
        if (!db) throw new Error("Firebase not initialized");
        await setDoc(doc(db, "users", userId, "security", "backup"), {
            ciphertext,
            iv,
            salt,
            version: 1,
            updatedAt: new Date().toISOString()
        });
    }

    static async restoreBackup(userId: string, pin: string): Promise<void> {
        // 1. Download
        if (!db) throw new Error("Firebase not initialized");
        const snap = await getDoc(doc(db, "users", userId, "security", "backup"));
        if (!snap.exists()) throw new Error("No backup found");

        const data = snap.data();
        
        // 2. Decrypt
        const key = await deriveKeyFromPin(pin, data.salt);
        
        try {
            const json = await decryptBlob(data.ciphertext, data.iv, key);
            const dump = JSON.parse(json);

            // 3. Import
            await SignalManager.getInstance().importData(dump);
        } catch (e) {
            console.error(e);
            throw new Error("Incorrect PIN or corrupted backup");
        }
    }
}
