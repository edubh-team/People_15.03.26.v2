
"use client";

import { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where,
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc, 
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCrypto } from "@/components/auth/CryptoProvider";
import { 
  decryptSessionKey, 
  decryptMessage, 
  encryptMessage, 
  generateSessionKey,
  encryptSessionKeyForUser,
  importPublicKey,
} from "@/lib/crypto";
import { MessageDoc, MessageType, ChannelDoc } from "./useChat";

export type SecureMessageDoc = MessageDoc & {
  isDecrypted?: boolean;
  decryptionError?: boolean;
};

export function useSecureChat(channelId: string | null) {
  const { firebaseUser } = useAuth();
  const { privateKey, publicKey, isReady } = useCrypto();
  const [messages, setMessages] = useState<SecureMessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
  const [keyError, setKeyError] = useState(false);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([]);
  const { deleteMessageLocal, undoDeleteMessageLocal } = useHiddenMessages(channelId);

  // Load "Delete for Me" hidden IDs (Synced with Firestore)
  useEffect(() => {
    if (!firebaseUser || !channelId || !db) return;

    const unsub = onSnapshot(doc(db, "users", firebaseUser.uid, "hidden_messages", channelId), (docSnap) => {
        if (docSnap.exists()) {
            setHiddenMessageIds(docSnap.data().messageIds || []);
        } else {
            setHiddenMessageIds([]);
        }
    });

    return () => unsub();
  }, [channelId, firebaseUser]);

  // 1. Subscribe to Session Key (Real-time Sync)
  useEffect(() => {
    if (!channelId || !firebaseUser || !db || !privateKey || !isReady) {
      setLoading(false);
      return;
    }

    let active = true;
    let retryCount = 0;

    const keyRef = doc(db, "channels", channelId, "access_keys", firebaseUser.uid);
    
    const unsub = onSnapshot(keyRef, async (keySnap) => {
        if (!active) return;
        setLoading(true);

        if (!keySnap.exists()) {
            console.warn("No access key found. Attempting to repair/initialize keys...");
            if (retryCount < 1) {
               retryCount++;
               try {
                  // Repair will write to Firestore, triggering this snapshot again.
                  await repairChannelKeys();
               } catch (repairErr) {
                  console.error("Failed to repair keys:", repairErr);
                  setKeyError(true);
               }
            } else {
               setKeyError(true);
            }
            setLoading(false);
            return;
        }

        const encryptedKey = keySnap.data().encryptedSessionKey;
        try {
            const decryptedKey = await decryptSessionKey(encryptedKey, privateKey);
            if (active) {
                setSessionKey(decryptedKey);
                setKeyError(false);
                retryCount = 0; // Reset retry on success
            }
        } catch (decryptErr) {
            console.warn("Session key decryption failed. Attempting repair...", decryptErr);
            if (retryCount < 1) {
                retryCount++;
                try {
                    await repairChannelKeys();
                } catch (repairErr) {
                    console.error("Failed to repair keys after decryption error:", repairErr);
                    if (active) setKeyError(true);
                }
            } else {
                console.error("Max retries reached for key repair.");
                if (active) setKeyError(true);
            }
        }
        if (active) setLoading(false);
    }, (error) => {
        console.error("Error listening to access keys:", error);
        if (active) setKeyError(true);
        if (active) setLoading(false);
    });
    
    async function repairChannelKeys() {
        if (!db || !firebaseUser || !channelId) throw new Error("Missing dependencies for key repair");
        const { getDoc, doc, writeBatch } = await import("firebase/firestore");
        
        // 1. Fetch Channel to get participants
        const channelRef = doc(db, "channels", channelId);
        const cSnap = await getDoc(channelRef);
        if (!cSnap.exists()) throw new Error("Channel does not exist");
        
        const data = cSnap.data();
        const participants: string[] = data?.participants || [];
        
        if (!participants.includes(firebaseUser.uid)) {
            throw new Error("You are not a participant of this channel");
        }

        // 2. Generate New Session Key
        const newSessionKey = await generateSessionKey();
        
        // 3. Encrypt for ALL participants
        const keysMap: Record<string, string> = {};
        
        await Promise.all(participants.map(async (uid) => {
             try {
                 let userPubKey: CryptoKey;

                 if (uid === firebaseUser.uid && publicKey) {
                     userPubKey = publicKey;
                 } else {
                     const uSnap = await getDoc(doc(db!, "users", uid));
                     const uData = uSnap.data();
                     const pubKeyBase64 = uData?.keys?.publicKey;
                     if (!pubKeyBase64) return;
                     userPubKey = await importPublicKey(pubKeyBase64);
                 }
                 
                 const encryptedSessionKey = await encryptSessionKeyForUser(newSessionKey, userPubKey);
                 keysMap[uid] = encryptedSessionKey;
             } catch (err) {
                 console.warn(`Skipping user ${uid} during repair`, err);
             }
        }));
        
        if (!keysMap[firebaseUser.uid]) {
            throw new Error("Could not encrypt key for self. Check your public key setup.");
        }
        
        const batch = writeBatch(db);
        Object.entries(keysMap).forEach(([uid, encKey]) => {
            const kRef = doc(db!, "channels", channelId, "access_keys", uid);
            batch.set(kRef, { encryptedSessionKey: encKey }, { merge: true });
        });
        
        await batch.commit();
        console.log("Channel keys repaired successfully.");
        return newSessionKey;
    }

    return () => { active = false; unsub(); };
  }, [channelId, firebaseUser, privateKey, publicKey, isReady]);

  // 2. Subscribe to Messages
  useEffect(() => {
    if (!channelId || !sessionKey || !db) return;

    const q = query(
      collection(db, "channels", channelId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const rawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as SecureMessageDoc));
      
      const decryptedDocs = await Promise.all(rawDocs.map(async (d) => {
        // Filter out "Delete for Me"
        if (hiddenMessageIds.includes(d.id)) return null;

        // Handle "Delete for Everyone"
        if (d.isDeleted) {
           return {
             ...d,
             content: "This message was deleted.",
             type: "text",
             isDecrypted: true
           } as SecureMessageDoc;
        }

        try {
           // Expect content to be JSON string of { ciphertext, iv } or just string?
           // The specs said: content: STRING (Ciphertext). 
           // But we need IV. I implemented encryptMessage to return {ciphertext, iv}.
           // I will store as JSON string in Firestore content field for simplicity.
           let contentObj;
           try {
             contentObj = JSON.parse(d.content);
           } catch {
             // Fallback if not JSON (maybe legacy plain text?)
             return { ...d, isDecrypted: true, content: d.content };
           }

           const plainText = await decryptMessage(contentObj.ciphertext, contentObj.iv, sessionKey);
           
           if (plainText === null) {
               return {
                   ...d,
                   content: "🔒 Message encrypted with old key",
                   decryptionError: true
               } as SecureMessageDoc;
           }

           return {
             ...d,
             content: plainText,
             isDecrypted: true
           } as SecureMessageDoc;
        } catch {
          return {
            ...d,
            content: "⚠️ Decryption Failed",
            decryptionError: true
          } as SecureMessageDoc;
        }
      }));

      setMessages(decryptedDocs.filter(Boolean) as SecureMessageDoc[]);
      setLoading(false);
    });

    return () => unsub();
  }, [channelId, sessionKey, hiddenMessageIds]);

  // 3. Send Message
  const sendMessage = async (text: string, type: MessageType = "text") => {
    if (!channelId || !sessionKey || !firebaseUser || !db) return;

    const { ciphertext, iv } = await encryptMessage(text, sessionKey);
    // Store IV and Ciphertext together
    const contentPayload = JSON.stringify({ ciphertext, iv });

    await addDoc(collection(db, "channels", channelId, "messages"), {
      content: contentPayload,
      senderId: firebaseUser.uid,
      type,
      createdAt: serverTimestamp(),
      readBy: [firebaseUser.uid],
      isDeleted: false
    });

    // Update Last Message (Encrypted Preview)
    // We can't easily show preview in sidebar without decrypting there too.
    // For now, sidebar will show "Encrypted Message" or we share session key with sidebar hook.
    // Spec says: "Sender: Encrypts text... Receiver: Decrypts". 
    // Ideally update channel with a hint or encrypted blob.
    // Sidebar usually just shows "Sent a message".
    await updateDoc(doc(db, "channels", channelId), {
      updatedAt: serverTimestamp(),
      lastMessage: {
        text: "🔒 Encrypted Message", // Placeholder to avoid re-encryption complexity in this hook
        senderId: firebaseUser.uid,
        timestamp: serverTimestamp(),
        readBy: [firebaseUser.uid]
      }
    });
  };

    // 4. Delete Message (Global)
    const deleteMessageGlobal = async (messageId: string) => {
        if (!db || !channelId) return;
        await updateDoc(doc(db, "channels", channelId, "messages", messageId), {
            isDeleted: true,
            content: "DELETED_CONTENT_MARKER" // Overwrite
        });
    };

    // 5. Add User to Channel (Secure Key Sharing)
    const addUserToChannel = async (targetUid: string) => {
        if (!db || !channelId || !sessionKey || !firebaseUser) throw new Error("Missing dependencies");
        const { getDoc, doc, writeBatch, arrayUnion } = await import("firebase/firestore");

        // 1. Fetch Target User's Public Key
        const uSnap = await getDoc(doc(db, "users", targetUid));
        const uData = uSnap.data();
        const pubKeyBase64 = uData?.keys?.publicKey;
        
        if (!pubKeyBase64) {
            throw new Error(`User ${uData?.displayName || targetUid} has no public key setup.`);
        }

        const userPubKey = await importPublicKey(pubKeyBase64);

        // 2. Encrypt Current Session Key for New User
        // This ensures they can read future messages AND history (since we share the same key)
        // To prevent history access, we would need to rotate the key here.
        const encryptedSessionKey = await encryptSessionKeyForUser(sessionKey, userPubKey);

        // 3. Batch Write: Add Participant & Add Key
        const batch = writeBatch(db);
        
        // Add to participants list
        const channelRef = doc(db, "channels", channelId);
        batch.update(channelRef, {
            participants: arrayUnion(targetUid)
        });

        // Add Access Key
        const keyRef = doc(db, "channels", channelId, "access_keys", targetUid);
        batch.set(keyRef, {
            encryptedSessionKey
        });

        await batch.commit();
    };

    return { 
      messages, 
      loading, 
      sendMessage, 
      keyError,
      deleteMessageLocal,
      undoDeleteMessageLocal,
      deleteMessageGlobal,
      addUserToChannel
    };
  }

// Helper Hook for Firestore Hidden Messages Logic
function useHiddenMessages(channelId: string | null) {
    const { firebaseUser } = useAuth();

    const deleteMessageLocal = async (msgId: string) => {
        if (!firebaseUser || !channelId || !db) return;
        const { arrayUnion, setDoc, doc } = await import("firebase/firestore");
        
        const ref = doc(db, "users", firebaseUser.uid, "hidden_messages", channelId);
        await setDoc(ref, {
            messageIds: arrayUnion(msgId)
        }, { merge: true });
    };

    const undoDeleteMessageLocal = async (msgId: string) => {
        if (!firebaseUser || !channelId || !db) return;
        const { arrayRemove, updateDoc, doc } = await import("firebase/firestore");
        
        const ref = doc(db, "users", firebaseUser.uid, "hidden_messages", channelId);
        await updateDoc(ref, {
            messageIds: arrayRemove(msgId)
        });
    };

    return { deleteMessageLocal, undoDeleteMessageLocal };
}

export function useSecureChannels() {
    const { firebaseUser } = useAuth();
    const [channels, setChannels] = useState<ChannelDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const { isReady } = useCrypto();

    // Fetch Channels
    useEffect(() => {
        if (!firebaseUser || !db) return;
        
        const q = query(
            collection(db, "channels"),
            where("participants", "array-contains", firebaseUser.uid),
            orderBy("updatedAt", "desc")
        );

        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChannelDoc));
            setChannels(list);
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser]);

    // Create Encrypted Group
    const createEncryptedGroup = async (name: string, participantUids: string[]) => {
        if (!db || !firebaseUser || !isReady) throw new Error("Not ready");
        
        const allUids = Array.from(new Set([...participantUids, firebaseUser.uid]));
        
        // 1. Generate Session Key
        const sessionKey = await generateSessionKey();
        
        // 2. Fetch Public Keys for ALL participants
        const keysMap: Record<string, string> = {}; // uid -> encryptedSessionKey
        
        // Batch fetch users to get public keys
        // Firestore 'in' limit is 10/30. For large groups, need chunking. 
        // For MVP, assuming < 30.
        // We can't easily fetch specific docs by ID in a single query unless using documentId().
        // Let's use Promise.all(getDoc)
        const { getDoc, doc } = await import("firebase/firestore");
        
        await Promise.all(allUids.map(async (uid) => {
            const uSnap = await getDoc(doc(db!, "users", uid));
            const uData = uSnap.data();
            const pubKeyBase64 = uData?.keys?.publicKey;
            
            if (!pubKeyBase64) {
                throw new Error(`User ${uData?.displayName || uid} has no public key setup.`);
            }
            
            const userPubKey = await importPublicKey(pubKeyBase64);
            const encryptedSessionKey = await encryptSessionKeyForUser(sessionKey, userPubKey);
            keysMap[uid] = encryptedSessionKey;
        }));

        // 3. Batch Write
        const batch = writeBatch(db);
        const channelRef = doc(collection(db, "channels"));
        
        batch.set(channelRef, {
            type: "GROUP",
            name,
            participants: allUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: firebaseUser.uid
        });

        // Write Access Keys
        allUids.forEach(uid => {
            const keyRef = doc(db!, "channels", channelRef.id, "access_keys", uid);
            batch.set(keyRef, {
                encryptedSessionKey: keysMap[uid]
            });
        });

        await batch.commit();
        return channelRef.id;
    };

    // Create Encrypted DM
    const createEncryptedDM = async (targetUid: string) => {
        if (!db || !firebaseUser || !isReady) throw new Error("Not ready");

        const uids = [firebaseUser.uid, targetUid].sort();
        const dmId = `dm-${uids[0]}-${uids[1]}`;
        const { getDoc, doc } = await import("firebase/firestore");
        const channelRef = doc(db, "channels", dmId);

        // Check if exists
        const docSnap = await getDoc(channelRef);
        if (docSnap.exists()) {
            return dmId;
        }

        // Generate Session Key
        const sessionKey = await generateSessionKey();
        
        // Encrypt for both
        const keysMap: Record<string, string> = {};
        
        await Promise.all(uids.map(async (uid) => {
            const uSnap = await getDoc(doc(db!, "users", uid));
            const uData = uSnap.data();
            const pubKeyBase64 = uData?.keys?.publicKey;
            
            if (!pubKeyBase64) {
                throw new Error(`User ${uData?.displayName || uid} has no public key setup.`);
            }
            
            const userPubKey = await importPublicKey(pubKeyBase64);
            const encryptedSessionKey = await encryptSessionKeyForUser(sessionKey, userPubKey);
            keysMap[uid] = encryptedSessionKey;
        }));

        // Batch Write
        const batch = writeBatch(db);
        
        batch.set(channelRef, {
            type: "DM",
            participants: uids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: firebaseUser.uid
        });

        uids.forEach(uid => {
            const keyRef = doc(db!, "channels", dmId, "access_keys", uid);
            batch.set(keyRef, {
                encryptedSessionKey: keysMap[uid]
            });
        });

        await batch.commit();
        return dmId;
    };

    return { channels, loading, createEncryptedGroup, createEncryptedDM };
}
