import { useState, useEffect } from "react";
import { collection, onSnapshot, query, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";

// 1. Data Fetching & Type Definition
export interface EmployeeProfile extends UserDoc {
  // Identity (Already in UserDoc: uid, displayName, email, photoURL)
  employeeId?: string; // Custom Employee ID (e.g., EMP-001)

  // Role/Org (Already in UserDoc: role, orgRole, reportsTo, status)
  department?: string;
  designation?: string;
  
  // Contact (Already in UserDoc: phone, address)
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };

  // HR Data
  joiningDate?: Timestamp | Date | string; // Flexible to handle Firestore types
  employmentType?: "Full-time" | "Part-time" | "Contract" | "Intern";
  
  // Banking (New)
  bankDetails?: {
    accountNumber: string;
    ifsc: string;
    bankName: string;
  };

  // System
  lastLogin?: Timestamp | Date | string;
}

export function useEmployeeDirectory() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setTimeout(() => {
        setError("Firebase not initialized");
        setLoading(false);
      }, 0);
      return;
    }

    // Requirement: Real-Time Sync using onSnapshot
    // Requirement: Fetch all users
    const q = query(collection(db, "users"), orderBy("displayName", "asc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          uid: doc.id,
          ...doc.data(),
        })) as EmployeeProfile[];
        
        console.log("Fetched Users:", data); // <--- DEBUGGER
        setEmployees(data);
        setLoading(false);
      },
      (err) => {
        console.error("Fetch Error:", err);
        setError(err.message); // <--- Show this in UI
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { employees, loading, error };
}
