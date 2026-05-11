"use client";

import { useState, useEffect } from "react";
import { getUserDoc } from "@/lib/firebase/users";

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
      setName(null);
      setRole(null);
      return;
    }
    const userUid = uid;
    
    async function fetchUser() {
      try {
        const userDoc = await getUserDoc(userUid);

        if (userDoc) {
          setName(userDoc.displayName || userDoc.email || "Unknown User");
          setRole(userDoc.orgRole || userDoc.role || "");
        } else {
          setName("Unknown User");
          setRole(null);
        }
      } catch (err) {
        console.error("Error fetching user name:", err);
        setName("Error");
        setRole(null);
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
