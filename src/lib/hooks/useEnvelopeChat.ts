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
  where
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { CryptoService, EnvelopeMessage } from "@/lib/encryption/CryptoService";
import { KeyPairManager } from "@/lib/encryption/KeyPairManager";
import { MessageDoc, MessageType, ChannelDoc } from "./useChat";

export type EnvelopeMessageDoc = Omit<MessageDoc, 'type'> & {
  type: MessageType;
  encryptedContent?: string;
  iv?: string;
  recipientKeys?: Record<string, string>;
  isDecrypted?: boolean;
  decryptionError?: boolean;
};

export function useEnvelopeChat(channelId: string | null) {
  const { firebaseUser } = useAuth();
  const [messages, setMessages] = useState<EnvelopeMessageDoc[]>([]);
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

  // Subscribe to Messages
  useEffect(() => {
    if (!channelId || !firebaseUser || !db) return;

    const q = query(
      collection(db, "channels", channelId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      try {
        // Ensure Keys are Ready
        await KeyPairManager.getInstance().ensureKeyPairExists(firebaseUser.uid);

        const rawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as EnvelopeMessageDoc));
        const processedDocs: EnvelopeMessageDoc[] = [];
        
        for (const d of rawDocs) {
          if (hiddenMessageIds.includes(d.id)) continue;
          
          if (d.isDeleted) {
             processedDocs.push({
               ...d,
               content: "This message was deleted.",
               isDecrypted: true
             });
             continue;
          }

          // Check if Envelope Encrypted
          if (d.encryptedContent && d.iv && d.recipientKeys) {
              try {
                  const envelope: EnvelopeMessage = {
                      encryptedContent: d.encryptedContent,
                      iv: d.iv,
                      recipientKeys: d.recipientKeys
                  };

                  const plaintext = await CryptoService.getInstance().decryptMessage(
                      firebaseUser.uid, 
                      envelope
                  );
                  
                  processedDocs.push({ 
                      ...d, 
                      content: plaintext, 
                      isDecrypted: true 
                  });
              } catch (e: unknown) {
                      const isKeyMismatch = e instanceof Error && e.message === "DECRYPTION_FAILED_KEY_MISMATCH";
                      const isNotRecipient = e instanceof Error && e.message === "You are not a recipient of this message.";
                      
                      if (!isKeyMismatch && !isNotRecipient) {
                          console.error(`Decryption failed for msg ${d.id}`, e);
                      }

                      let errorMessage = "🔒 Decryption Failed";
                      if (isKeyMismatch) errorMessage = "🔒 Key Changed (Unreadable)";
                      if (isNotRecipient) errorMessage = "🔒 Not a Recipient";

                      processedDocs.push({ 
                          ...d, 
                          content: errorMessage, 
                          isDecrypted: false,
                          decryptionError: true
                      });
                  }
          } else {
              // Legacy or Plaintext
              processedDocs.push({ ...d, isDecrypted: true });
          }
        }

        setMessages(processedDocs);
      } catch (error) {
        console.error("Error initializing keys or processing messages:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [channelId, firebaseUser, hiddenMessageIds]);

  const sendMessage = async (text: string, type: MessageType = 'text') => {
    if (!channelId || !firebaseUser || !db) throw new Error("Not ready");
    
    // 1. Get Participants
    const cSnap = await getDoc(doc(db, "channels", channelId));
    if (!cSnap.exists()) throw new Error("Channel not found");
    
    const participants: string[] = cSnap.data().participants || [];
    
    // 2. Encrypt for Everyone (including self)
    const allTargets = Array.from(new Set([...participants, firebaseUser.uid]));
    
    const envelope = await CryptoService.getInstance().encryptMessage(text, allTargets);
    const missingRecipients = allTargets.filter((uid) => !envelope.recipientKeys[uid]);
    if (missingRecipients.length > 0) {
      throw new Error(
        `Cannot send yet. ${missingRecipients.length} participant(s) need to sign in once to initialize secure messaging.`,
      );
    }

    // 3. Send
    await addDoc(collection(db, "channels", channelId, "messages"), {
      // Metadata
      senderId: firebaseUser.uid,
      createdAt: serverTimestamp(),
      type: type,
      isDeleted: false,
      readBy: [firebaseUser.uid],
      
      // Envelope Data
      encryptedContent: envelope.encryptedContent,
      iv: envelope.iv,
      recipientKeys: envelope.recipientKeys,
      
      // Fallback content for list views (optional, secure placeholder)
      text: type === 'image' ? "🔒 Encrypted Image" : "🔒 Encrypted Message"
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
          text: "DELETED_CONTENT_MARKER",
          encryptedContent: null,
          iv: null,
          recipientKeys: null
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

export function useSecureChannels() {
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
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChannelDoc));
            setChannels(list);
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser]);

    const createSecureDM = async (targetUid: string) => {
        if (!db || !firebaseUser) throw new Error("Not ready");

        const uids = [firebaseUser.uid, targetUid].sort();
        const dmId = `dm-${uids[0]}-${uids[1]}`;
        const channelRef = doc(db, "channels", dmId);

        // Check if exists
        const docSnap = await getDoc(channelRef);
        if (docSnap.exists()) {
            return dmId;
        }

        // Create DM Channel
        await setDoc(channelRef, {
            type: "DM",
            participants: uids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: firebaseUser.uid
        }, { merge: true });

        return dmId;
    };

    return { channels, loading, createSecureDM };
}
