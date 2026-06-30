import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

/**
 * Generates a unique employee ID in the format EBH + 5 random digits (e.g., EBH49210).
 * Checks Firestore to ensure uniqueness.
 */
export const generateUniqueEmployeeId = async (): Promise<string> => {
  if (!db) throw new Error("Firestore is not initialized");

  const prefix = "EBH";
  let isUnique = false;
  let customId = "";

  // Retry loop to ensure uniqueness
  while (!isUnique) {
    // Generate 5 random digits (10000 to 99999)
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    customId = `${prefix}${randomDigits}`;

    // Check Firestore for collision
    const q = query(collection(db, 'users'), where('employeeId', '==', customId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      isUnique = true; // Found a free slot!
    }
  }

  return customId;
};
