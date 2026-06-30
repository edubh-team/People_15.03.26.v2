import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit as fbLimit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function useIdentityScopeUids(userDoc: UserDoc | null | undefined) {
  const userUid = userDoc?.uid ?? null;
  const [scopeUids, setScopeUids] = useState<string[]>(() =>
    userUid ? [userUid] : [],
  );

  const identityKey = useMemo(() => {
    const emailRaw = normalizeText(userDoc?.email);
    const emailLower = emailRaw.toLowerCase();
    const employeeId = normalizeText(userDoc?.employeeId ?? null);
    return [userUid ?? "", emailRaw, emailLower, employeeId].join("|");
  }, [userDoc?.email, userDoc?.employeeId, userUid]);

  useEffect(() => {
    if (!userUid || !db) {
      setScopeUids(userUid ? [userUid] : []);
      return;
    }

    let active = true;
    const firestore = db;
    const aliases = new Set<string>([userUid]);
    const lookups: Array<Promise<Awaited<ReturnType<typeof getDocs>>>> = [];

    const emailRaw = normalizeText(userDoc?.email);
    const emailLower = emailRaw.toLowerCase();
    const employeeId = normalizeText(userDoc?.employeeId ?? null);

    if (emailRaw) {
      lookups.push(
        getDocs(
          query(collection(firestore, "users"), where("email", "==", emailRaw), fbLimit(25)),
        ),
      );
      if (emailLower !== emailRaw) {
        lookups.push(
          getDocs(
            query(
              collection(firestore, "users"),
              where("email", "==", emailLower),
              fbLimit(25),
            ),
          ),
        );
      }
    }

    if (employeeId) {
      lookups.push(
        getDocs(
          query(
            collection(firestore, "users"),
            where("employeeId", "==", employeeId),
            fbLimit(25),
          ),
        ),
      );
    }

    if (lookups.length === 0) {
      setScopeUids([userUid]);
      return;
    }

    Promise.all(lookups)
      .then((snapshots) => {
        snapshots.forEach((snapshot) => {
          snapshot.docs.forEach((row) => {
            aliases.add(row.id);
            const data = row.data() as Partial<UserDoc>;
            const nestedUid = normalizeText(
              typeof data.uid === "string" ? data.uid : null,
            );
            if (nestedUid) aliases.add(nestedUid);
          });
        });
      })
      .catch((error) => {
        console.error("Failed to load identity scope aliases", error);
      })
      .finally(() => {
        if (!active) return;
        setScopeUids(Array.from(aliases));
      });

    return () => {
      active = false;
    };
  }, [identityKey, userDoc?.email, userDoc?.employeeId, userUid]);

  return scopeUids;
}
