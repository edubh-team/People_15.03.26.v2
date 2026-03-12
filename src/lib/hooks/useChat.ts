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
  limit,
  Timestamp,
  setDoc,
  arrayUnion
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type MessageType = "text" | "image" | "file";

export type MessageDoc = {
  id: string;
  senderId: string;
  content: string;
  type: MessageType;
  readBy: string[];
  createdAt: Timestamp | null;
  isDeleted?: boolean;
};

export type ChannelType = "TEAM" | "GROUP" | "DM" | "BROADCAST";

export type ChannelDoc = {
  id: string;
  type: ChannelType;
  name?: string;
  participants: string[];
  archivedBy?: string[];
  lastMessage?: {
    text: string;
    senderId: string;
    timestamp: Timestamp;
    readBy?: string[];
  };
  updatedAt: Timestamp;
};

export function useChannels() {
  const { firebaseUser } = useAuth();
  const [channels, setChannels] = useState<ChannelDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUser || !db) {
        const t = setTimeout(() => setLoading(false), 0);
        return () => clearTimeout(t);
    }

    const q = query(
      collection(db, "channels"),
      where("participants", "array-contains", firebaseUser.uid),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChannelDoc));
      setChannels(list);
      setLoading(false);
    }, (err) => {
        console.error("Error fetching channels:", err);
        setLoading(false);
    });

    return () => unsub();
  }, [firebaseUser]);

  const createDM = async (targetUid: string) => {
      if (!firebaseUser || !db) return null;
      // Check if DM exists
      // Note: This is a bit expensive without a direct composite ID or specialized query.
      // Convention: DM ID could be sorted UIDs: dm-uid1-uid2
      const uids = [firebaseUser.uid, targetUid].sort();
      const dmId = `dm-${uids[0]}-${uids[1]}`;
      
      const docRef = doc(db, "channels", dmId);
      // We use setDoc with merge to ensure creation or idempotency
      await setDoc(docRef, {
          type: "DM",
          participants: uids,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp() // will only set on create if merge logic is handled or we use get() first.
          // Simple set is fine for now
      }, { merge: true });
      
      return dmId;
  };

  return { channels, loading, createDM };
}

export function useChat(channelId: string | null) {
  const { firebaseUser } = useAuth();
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId || !db) {
        const t = setTimeout(() => setMessages([]), 0);
        return () => clearTimeout(t);
    }

    const loadingTimer = setTimeout(() => setLoading(true), 0);
    
    const q = query(
      collection(db, "channels", channelId, "messages"),
      orderBy("createdAt", "asc"),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      clearTimeout(loadingTimer);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as MessageDoc));
      setMessages(list);
      setLoading(false);
    });

    return () => {
        clearTimeout(loadingTimer);
        unsub();
    };
  }, [channelId]);

  const sendMessage = async (content: string, type: MessageType = "text") => {
    if (!channelId || !firebaseUser || !db || !content.trim()) return;

    await addDoc(collection(db, "channels", channelId, "messages"), {
      senderId: firebaseUser.uid,
      content: content.trim(),
      type,
      readBy: [firebaseUser.uid],
      createdAt: serverTimestamp(),
    });
    
    // Last message update is handled by Cloud Function trigger for consistency,
    // but we can optimistically update UI if needed.
  };

  const markAsRead = async () => {
     if (!channelId || !firebaseUser || !db) return;
     // Logic to mark all unread messages as read? 
     // Or just update the channel's "lastMessage.readBy"?
     // Typically read receipts are per message or per channel cursor.
     // For simplicity: update channel's lastMessage.readBy
     
     // Note: This needs complex logic to track *which* messages are read. 
     // Simplest Apple-style: Just mark the "Channel" as read by user.
     const channelRef = doc(db, "channels", channelId);
     // We can't easily update a field inside a map in an array without knowing the index or structure.
     // Alternative: separate collection `channels/{id}/read_receipts/{uid}`
     
     // For this MVP: We assume the lastMessage field has a readBy array.
     await updateDoc(channelRef, {
         "lastMessage.readBy": arrayUnion(firebaseUser.uid)
     });
  };

  return { messages, loading, sendMessage, markAsRead };
}
