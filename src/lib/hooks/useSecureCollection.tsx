"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  limit as fbLimit,
  onSnapshot,
  query,
  where,
  type Query,
} from "firebase/firestore";
import { normalizeTaskDoc } from "@/lib/tasks/model";

type Role = "employee" | "teamLead" | "admin" | "manager" | "unknown";

type SecureOptions =
  | { collection: "leads"; limit?: number }
  | { collection: "tasks"; limit?: number }
  | { collection: string; limit?: number };

type State<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
  errorBanner: ReactNode;
};

function chunk<T>(arr: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function keyOf<T>(row: T): string {
  const r = row as unknown as { id?: string; leadId?: string };
  return (r.leadId ?? r.id ?? "") as string;
}

export async function getUserRole(uid: string) {
  if (!db || !uid) return "unknown" as Role;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return "unknown";
  const raw = snap.data() as { role?: string; orgRole?: string | null };
  if ((raw.orgRole ?? "").toUpperCase() === "SUPER_ADMIN") return "admin";
  const r = String(raw.role ?? "employee") as Role;
  return (["employee", "teamLead", "admin", "manager"].includes(r) ? r : "unknown") as Role;
}

async function getSubordinateUids(uid: string) {
  if (!db || !uid) return [];
  const subs: string[] = [];
  const qDefs: Array<Query> = [
    query(collection(db, "users"), where("reportsTo", "==", uid), where("role", "==", "employee"), fbLimit(500)),
    query(collection(db, "users"), where("teamLeadId", "==", uid), where("role", "==", "employee"), fbLimit(500)),
    query(collection(db, "users"), where("managerId", "==", uid), where("role", "==", "employee"), fbLimit(500)),
  ];
  for (const q of qDefs) {
    const snap = await import("firebase/firestore").then((m) => m.getDocs(q));
    for (const d of snap.docs) {
      const u = d.data() as { uid?: string };
      subs.push((u.uid ?? d.id) as string);
    }
  }
  return Array.from(new Set(subs));
}

export function useSecureCollection<T = unknown>(uid: string | null | undefined, opts: SecureOptions): State<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const limitN = opts.limit ?? 1000;

  const errorBanner = useMemo(() => {
    if (!error) return null;
    return (
      <div className="rounded-[16px] border border-rose-200 bg-white/70 px-4 py-3 text-sm text-rose-700 shadow-sm backdrop-blur-md">
        {error.message.includes("permission-denied")
          ? "Missing or insufficient permissions for this view."
          : "Unable to load data."}
      </div>
    );
  }, [error]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    async function run() {
      setLoading(true);
      setError(null);
      try {
        if (!db || !uid) {
          setData([]);
          return;
        }
        const role = await getUserRole(uid);

        if (role === "admin") {
          const base = query(collection(db, opts.collection), fbLimit(limitN));
          const unsub = onSnapshot(
            base,
            (snap) => {
              const rows = snap.docs.map((d) => {
                const raw = d.data() as unknown as T;
                const k = keyOf(raw) || d.id;
                return Object.assign({}, raw, { id: k }) as T;
              });
              setData(rows);
              setLoading(false);
            },
            (err) => {
              setError(err);
              setLoading(false);
            },
          );
          unsubs.push(unsub);
        } else if (role === "teamLead") {
          const subs = await getSubordinateUids(uid);
          if (subs.length === 0) {
            setData([]);
            setLoading(false);
          } else {
            if (opts.collection === "leads") {
              for (const part of chunk(subs, 10)) {
                const q1 = query(collection(db, "leads"), where("assignedTo", "in", part), fbLimit(limitN));
                const q2 = query(collection(db, "leads"), where("ownerUid", "in", part), fbLimit(limitN));
                const u1 = onSnapshot(
                  q1,
                  (snap) => {
                    const next = snap.docs.map((d) => {
                      const raw = d.data() as unknown as T;
                      const k = keyOf(raw) || d.id;
                      return Object.assign({}, raw, { leadId: k }) as T;
                    });
                    setData((prev) => {
                      const map: Record<string, T> = {};
                      for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                      return Object.values(map);
                    });
                    setLoading(false);
                  },
                  (err) => {
                    setError(err);
                    setLoading(false);
                  },
                );
                const u2 = onSnapshot(
                  q2,
                  (snap) => {
                    const next = snap.docs.map((d) => {
                      const raw = d.data() as unknown as T;
                      const k = keyOf(raw) || d.id;
                      return Object.assign({}, raw, { leadId: k }) as T;
                    });
                    setData((prev) => {
                      const map: Record<string, T> = {};
                      for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                      return Object.values(map);
                    });
                    setLoading(false);
                  },
                  (err) => {
                    setError(err);
                    setLoading(false);
                  },
                );
                unsubs.push(u1, u2);
              }
            } else if (opts.collection === "tasks") {
              for (const part of chunk(subs, 10)) {
                const handleSnapshot = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
                  const next = snap.docs.map((d) => {
                    const normalized = normalizeTaskDoc(d.data(), d.id) as unknown as T;
                    const k = keyOf(normalized) || d.id;
                    return Object.assign({}, normalized, { id: k }) as T;
                  });
                  setData((prev) => {
                    const map: Record<string, T> = {};
                    for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                    return Object.values(map);
                  });
                  setLoading(false);
                };
                const handleError = (err: Error) => {
                  setError(err);
                  setLoading(false);
                };
                unsubs.push(
                  onSnapshot(
                    query(collection(db, "tasks"), where("assignedTo", "in", part), fbLimit(limitN)),
                    handleSnapshot,
                    handleError,
                  ),
                  onSnapshot(
                    query(collection(db, "tasks"), where("assigneeUid", "in", part), fbLimit(limitN)),
                    handleSnapshot,
                    handleError,
                  ),
                );
              }
            } else {
              for (const part of chunk(subs, 10)) {
                const q = query(collection(db, opts.collection), where("assignedTo", "in", part), fbLimit(limitN));
                const u = onSnapshot(
                  q,
                  (snap) => {
                    const next = snap.docs.map((d) => {
                      const raw = d.data() as unknown as T;
                      const k = keyOf(raw) || d.id;
                      return Object.assign({}, raw, { id: k }) as T;
                    });
                    setData((prev) => {
                      const map: Record<string, T> = {};
                      for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                      return Object.values(map);
                    });
                    setLoading(false);
                  },
                  (err) => {
                    setError(err);
                    setLoading(false);
                  },
                );
                unsubs.push(u);
              }
            }
          }
        } else {
          if (opts.collection === "leads") {
            const q1 = query(collection(db, "leads"), where("assignedTo", "==", uid), fbLimit(limitN));
            const q2 = query(collection(db, "leads"), where("ownerUid", "==", uid), fbLimit(limitN));
            const u1 = onSnapshot(
              q1,
              (snap) => {
                const next = snap.docs.map((d) => {
                  const raw = d.data() as unknown as T;
                  const k = keyOf(raw) || d.id;
                  return Object.assign({}, raw, { leadId: k }) as T;
                });
                setData((prev) => {
                  const map: Record<string, T> = {};
                  for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                  return Object.values(map);
                });
                setLoading(false);
              },
              (err) => {
                setError(err);
                setLoading(false);
              },
            );
            const u2 = onSnapshot(
              q2,
              (snap) => {
                const next = snap.docs.map((d) => {
                  const raw = d.data() as unknown as T;
                  const k = keyOf(raw) || d.id;
                  return Object.assign({}, raw, { leadId: k }) as T;
                });
                setData((prev) => {
                  const map: Record<string, T> = {};
                  for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                  return Object.values(map);
                });
                setLoading(false);
              },
              (err) => {
                setError(err);
                setLoading(false);
              },
            );
            unsubs.push(u1, u2);
          } else if (opts.collection === "tasks") {
            const handleSnapshot = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
              const next = snap.docs.map((d) => {
                const normalized = normalizeTaskDoc(d.data(), d.id) as unknown as T;
                const k = keyOf(normalized) || d.id;
                return Object.assign({}, normalized, { id: k }) as T;
              });
              setData((prev) => {
                const map: Record<string, T> = {};
                for (const r of [...prev, ...next]) map[keyOf(r)] = r;
                return Object.values(map);
              });
              setLoading(false);
            };
            const handleError = (err: Error) => {
              setError(err);
              setLoading(false);
            };
            unsubs.push(
              onSnapshot(
                query(collection(db, "tasks"), where("assignedTo", "==", uid), fbLimit(limitN)),
                handleSnapshot,
                handleError,
              ),
              onSnapshot(
                query(collection(db, "tasks"), where("assigneeUid", "==", uid), fbLimit(limitN)),
                handleSnapshot,
                handleError,
              ),
            );
          } else {
            const q = query(collection(db, opts.collection), where("assignedTo", "==", uid), fbLimit(limitN));
            const u = onSnapshot(
              q,
              (snap) => {
                const next = snap.docs.map((d) => {
                  const raw = d.data() as unknown as T;
                  const k = keyOf(raw) || d.id;
                  return Object.assign({}, raw, { id: k }) as T;
                });
                setData(next);
                setLoading(false);
              },
              (err) => {
                setError(err);
                setLoading(false);
              },
            );
            unsubs.push(u);
          }
        }

        return;
      } catch (err) {
        setError(err as Error);
        setLoading(false);
      }
    }
    void run();
    return () => {
      for (const u of unsubs) u();
    };
  }, [uid, opts.collection, limitN]);

  return { data, loading, error, errorBanner };
}
