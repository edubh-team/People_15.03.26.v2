"use client";

import { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
  where,
  writeBatch
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { SignalManager } from "@/lib/signal/SignalManager";
import { MessageDoc, MessageType, ChannelDoc } from "./useChat";

export type SignalMessageDoc = Omit<MessageDoc, 'type'> & {
  type: number | MessageType; // Allow both Signal types (number) and standard types
  isDecrypted?: boolean;
  decryptionError?: boolean;
  registrationId?: number;
  ciphertexts?: Record<string, { type: number, body?: string, registrationId: number }>;
  signalMessageType?: number;
};

export function useSignalChat(channelId: string | null) {
  const { firebaseUser } = useAuth();
  const [messages, setMessages] = useState<SignalMessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([]);
  
  const { deleteMessageLocal, undoDeleteMessageLocal } = useHiddenMessages(channelId);

  // Load "Delete for Me" hidden IDs
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

  // Initialize Signal Manager
  useEffect(() => {
    if (firebaseUser) {
      SignalManager.getInstance().initialize(firebaseUser.uid);
    }
  }, [firebaseUser]);

  // Subscribe to Messages
  useEffect(() => {
    if (!channelId || !firebaseUser || !db) return;

    const q = query(
      collection(db, "channels", channelId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      // Ensure SignalManager is initialized (Defensive fix for HMR/Race conditions)
      if (firebaseUser) {
          await SignalManager.getInstance().initialize(firebaseUser.uid);
      }

      const rawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as SignalMessageDoc));
      
      // Process sequentially to avoid Signal Protocol Session Race Conditions
      const processedDocs: SignalMessageDoc[] = [];
      
      for (const d of rawDocs) {
        // Filter out "Delete for Me"
        if (hiddenMessageIds.includes(d.id)) continue;
        
        if (d.isDeleted) {
           processedDocs.push({
             ...d,
             content: "This message was deleted.",
             isDecrypted: true
           });
           continue;
        }

        // Check if message is Signal-encrypted
        if (d.type === 1 || d.type === 3 || d.ciphertexts) {
            
            // 1. Determine which ciphertext to use
            let ciphertext = d.content || ""; // Fallback
            let msgType = typeof d.type === 'number' ? d.type : 1;

            if (d.ciphertexts && d.ciphertexts[firebaseUser.uid]) {
                ciphertext = d.ciphertexts[firebaseUser.uid].body || "";
                msgType = d.ciphertexts[firebaseUser.uid].type;
            } else if (d.senderId === firebaseUser.uid && d.content === "🔒 Encrypted Message" && !d.ciphertexts?.[firebaseUser.uid]) {
                 // Sent by me, but I didn't encrypt for myself (legacy behavior or failure)
                 processedDocs.push({ ...d, content: "You sent this (Encrypted)", isDecrypted: true });
                 continue;
            }

            try {
                // Wait for each decryption to finish before starting the next one
                const decryptedContent = await SignalManager.getInstance().decryptMessage(d.senderId, ciphertext, msgType);
                
                if (typeof decryptedContent === 'object' && 'error' in decryptedContent) {
                    // Log error but don't break the UI
                    console.warn(`[Signal] Decryption failed for msg ${d.id}:`, decryptedContent.error);
                    processedDocs.push({ 
                        ...d, 
                        content: "🔒 Decryption Failed", 
                        isDecrypted: false,
                        decryptionError: true
                    });
                } else {
                    processedDocs.push({ 
                        ...d, 
                        content: decryptedContent, 
                        signalMessageType: msgType, 
                        isDecrypted: true 
                    });
                }
            } catch (e) {
                console.error(`[Signal] Unexpected error processing msg ${d.id}:`, e);
                processedDocs.push({ 
                    ...d, 
                    content: "⚠️ Error", 
                    isDecrypted: false,
                    decryptionError: true
                });
            }
        } else {
            // Legacy or Plaintext messages
            processedDocs.push({ ...d, isDecrypted: true });
        }
      }

      setMessages(processedDocs);
      setLoading(false);
    });

    return () => unsub();
  }, [channelId, firebaseUser, hiddenMessageIds]);

  const sendMessage = async (text: string, type: MessageType = 'text') => {
    if (!channelId || !firebaseUser || !db) throw new Error("Not ready");
    
    // Ensure SignalManager is initialized (Defensive fix for HMR/Race conditions)
    await SignalManager.getInstance().initialize(firebaseUser.uid);

    // 1. Get Participants
    const cSnap = await getDoc(doc(db, "channels", channelId));
    if (!cSnap.exists()) throw new Error("Channel not found");
    
    const participants: string[] = cSnap.data().participants || [];
    const recipients = participants.filter(uid => uid !== firebaseUser.uid);

    if (recipients.length === 0) throw new Error("No recipients in channel");
    
    // 2. Encrypt for Everyone (Group Logic)
    // We include ourselves in the encryption list so we can read it on other devices (or this one if we reload)
    const allTargets = Array.from(new Set([...participants, firebaseUser.uid]));
    
    let encryptedMap;
    try {
        encryptedMap = await SignalManager.getInstance().encryptGroupMessage(allTargets, text);
    } catch (e: unknown) {
        console.error("Encryption failed:", e);
        if (e instanceof Error && e.message && e.message.includes("has no keys setup")) {
            throw new Error("This user has not set up encryption yet. Tell them to log in.");
        }
        throw e;
    }

    // 3. Send
    await addDoc(collection(db, "channels", channelId, "messages"), {
      text: type === 'image' ? "🔒 Encrypted Image" : "🔒 Encrypted Message", // Fallback / Metadata
      ciphertexts: encryptedMap, // { [uid]: { type, body, registrationId } }
      senderId: firebaseUser.uid,
      createdAt: serverTimestamp(),
      type: type, // Store actual content type (text/image)
      isDeleted: false,
      readBy: [firebaseUser.uid]
    });

    // Update Last Message
    await updateDoc(doc(db, "channels", channelId), {
      updatedAt: serverTimestamp(),
      lastMessage: {
        text: type === 'image' ? "🔒 Encrypted Image" : "🔒 Encrypted Message",
        senderId: firebaseUser.uid,
        timestamp: serverTimestamp(),
        readBy: [firebaseUser.uid]
      },
      ...(participants.length > 0 ? { archivedBy: arrayRemove(...participants) } : {}),
    });
  };

  const deleteMessageGlobal = async (messageId: string) => {
      if (!db || !channelId) return;
      await updateDoc(doc(db, "channels", channelId, "messages", messageId), {
          isDeleted: true,
          text: "DELETED_CONTENT_MARKER" 
      });
  };

  return {
    messages,
    loading,
    sendMessage,
    deleteMessageLocal,
    undoDeleteMessageLocal,
    deleteMessageGlobal
  };
}

// Helper Hook for Firestore Hidden Messages Logic
function useHiddenMessages(channelId: string | null) {
    const { firebaseUser } = useAuth();

    const deleteMessageLocal = async (msgId: string) => {
        if (!firebaseUser || !channelId || !db) return;
        
        const ref = doc(db, "users", firebaseUser.uid, "hidden_messages", channelId);
        await setDoc(ref, {
            messageIds: arrayUnion(msgId)
        }, { merge: true });
    };

    const undoDeleteMessageLocal = async (msgId: string) => {
        if (!firebaseUser || !channelId || !db) return;
        
        const ref = doc(db, "users", firebaseUser.uid, "hidden_messages", channelId);
        await updateDoc(ref, {
            messageIds: arrayRemove(msgId)
        });
    };

    return { deleteMessageLocal, undoDeleteMessageLocal };
}

export function useSignalChannels() {
    const { firebaseUser } = useAuth();
    const [channels, setChannels] = useState<ChannelDoc[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!firebaseUser || !db) return;
        
        const q = query(
            collection(db, "channels"),
            where("participants", "array-contains", firebaseUser.uid),
            orderBy("updatedAt", "desc")
        );

        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs
              .map((d) => ({ id: d.id, ...d.data() } as ChannelDoc))
              .filter((channel) => !(channel.archivedBy ?? []).includes(firebaseUser.uid));
            setChannels(list);
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser]);

    const createSignalDM = async (targetUid: string) => {
        if (!db || !firebaseUser) throw new Error("Not ready");

        const uids = [firebaseUser.uid, targetUid].sort();
        const dmId = `dm-${uids[0]}-${uids[1]}`;
        const channelRef = doc(db, "channels", dmId);

        // Check if exists
        try {
            const docSnap = await getDoc(channelRef);
            if (docSnap.exists()) {
                await updateDoc(channelRef, {
                  archivedBy: arrayRemove(firebaseUser.uid),
                  updatedAt: serverTimestamp(),
                });
                return dmId;
            }
        } catch (e: unknown) {
            // Ignore permission error (likely implies non-existence due to restrictive rules)
            // If it really exists and we lack permission, the subsequent setDoc will also fail, which is fine.
            const code = (e as { code?: string })?.code;
            if (code !== 'permission-denied') {
                console.warn("Error checking DM existence:", e);
            }
        }

        // Create DM Channel (No keys needed upfront for Signal)
        // Use setDoc with merge to be safe.
        // Note: This might update createdAt if the doc existed but we couldn't read it.
        // Given the deterministic ID, this collision is rare unless re-joining.
        await setDoc(channelRef, {
            type: "DM",
            participants: uids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: firebaseUser.uid,
            archivedBy: [],
        }, { merge: true });

        return dmId;
    };

    const createSignalGroup = async (name: string, participantUids: string[]) => {
        if (!db || !firebaseUser) throw new Error("Not ready");
        
        const allUids = Array.from(new Set([...participantUids, firebaseUser.uid]));
        
        // Create Group Channel
        const channelRef = doc(collection(db, "channels"));
        
        await setDoc(channelRef, {
            type: "GROUP",
            name,
            participants: allUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: firebaseUser.uid,
            archivedBy: [],
        });

        return channelRef.id;
    };

    const deleteChannel = async (channelId: string) => {
        if (!db || !firebaseUser) throw new Error("Not ready");
        if (!confirm("Remove this chat from your inbox? Other participants will still keep it.")) return;
        await updateDoc(doc(db, "channels", channelId), {
          archivedBy: arrayUnion(firebaseUser.uid),
          updatedAt: serverTimestamp(),
        });
    };

    const deleteAllChannels = async () => {
        if (!db || !firebaseUser) throw new Error("Not ready");
        const firestore = db;
        if (!confirm("Remove all chats from your inbox? Other participants will still keep them.")) return;
        
        // Batch archive from current user's inbox.
        const batch = writeBatch(firestore);
        let count = 0;
        
        channels.forEach(channel => {
            const ref = doc(firestore, "channels", channel.id);
            batch.update(ref, {
              archivedBy: arrayUnion(firebaseUser.uid),
              updatedAt: serverTimestamp(),
            });
            count++;
        });

        if (count > 0) {
            await batch.commit();
        }
    };

    return { channels, loading, createSignalDM, createSignalGroup, deleteChannel, deleteAllChannels };
}
