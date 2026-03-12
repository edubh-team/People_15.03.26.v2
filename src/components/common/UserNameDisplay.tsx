"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

interface Props {
  uid: string | null | undefined;
  fallback?: React.ReactNode;
  className?: string;
  showRole?: boolean;
}

export default function UserNameDisplay({ uid, fallback = "Unassigned", className, showRole = false }: Props) {
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    // Check cache first if possible (omitted for simplicity, but good practice)
    
    async function fetchUser() {
      try {
        if (!db) return;
        const userRef = doc(db, "users", uid!);
        const snap = await getDoc(userRef);
        
        if (snap.exists()) {
          const data = snap.data();
          setName(data.displayName || data.email || "Unknown User");
          setRole(data.orgRole || data.role || "");
        } else {
          setName("Unknown User");
        }
      } catch (err) {
        console.error("Error fetching user name:", err);
        setName("Error");
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, [uid]);

  if (!uid) {
    return <span className={className}>{fallback}</span>;
  }

  if (loading) {
    return <span className={`animate-pulse bg-slate-200 rounded h-4 w-20 inline-block align-middle ${className}`}></span>;
  }

  return (
    <span className={className} title={uid}>
      {name}
      {showRole && role ? <span className="text-xs text-slate-400 ml-1">({role})</span> : null}
    </span>
  );
}
