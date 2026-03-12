"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserAccountStatus, UserDoc, UserRole } from "@/lib/types/user";

const usersKey = ["users"];

type UseUsersOptions = {
  maxResults?: number;
  onlyActive?: boolean;
  sortByName?: boolean;
};

export function useUsers(options?: UseUsersOptions) {
  const maxResults = Math.max(1, Math.min(options?.maxResults ?? 200, 3000));
  const onlyActive = options?.onlyActive ?? false;
  const sortByName = options?.sortByName ?? false;
  return useQuery({
    queryKey: [...usersKey, maxResults, onlyActive, sortByName],
    queryFn: async () => {
      if (!db) throw new Error("Firebase is not configured");
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"), limit(maxResults));
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => d.data() as UserDoc);
      const scoped = onlyActive
        ? docs.filter(
            (user) =>
              user.status === "active" &&
              (typeof user.isActive === "undefined" || Boolean(user.isActive)),
          )
        : docs;
      if (!sortByName) return scoped;
      return [...scoped].sort((a, b) => {
        const aName = (a.displayName ?? a.email ?? a.uid ?? "").toLowerCase();
        const bName = (b.displayName ?? b.email ?? b.uid ?? "").toLowerCase();
        return aName.localeCompare(bName);
      });
    },
  });
}

export function useUpsertUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      uid: string;
      email?: string | null;
      displayName?: string | null;
      role?: UserRole;
      status?: UserAccountStatus;
      teamLeadId?: string | null;
    }) => {
      if (!db) throw new Error("Firebase is not configured");
      if (!input.uid.trim()) throw new Error("UID is required");

      const ref = doc(db, "users", input.uid.trim());
      await setDoc(
        ref,
        {
          uid: input.uid.trim(),
          email: input.email ?? null,
          displayName: input.displayName ?? null,
          role: input.role ?? "employee",
          status: input.status ?? "active",
          teamLeadId: input.teamLeadId ?? null,
          reportsTo: input.teamLeadId ?? null, // Sync reportsTo with teamLeadId
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        } satisfies Partial<UserDoc>,
        { merge: true },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: usersKey });
      const prev = queryClient.getQueryData<UserDoc[]>(usersKey);
      if (prev) {
        queryClient.setQueryData<UserDoc[]>(
          usersKey,
          prev.map((u) =>
            u.uid !== input.uid
              ? u
              : {
                  ...u,
                  ...(input.role ? { role: input.role } : {}),
                  ...(input.status ? { status: input.status } : {}),
                  ...(typeof input.teamLeadId !== "undefined"
                    ? { teamLeadId: input.teamLeadId }
                    : {}),
                  ...(typeof input.displayName !== "undefined"
                    ? { displayName: input.displayName }
                    : {}),
                },
          ),
        );
      }
      return { prev };
    },
    mutationFn: async (input: {
      uid: string;
      role?: UserRole;
      status?: UserAccountStatus;
      teamLeadId?: string | null;
      displayName?: string | null;
    }) => {
      if (!db) throw new Error("Firebase is not configured");
      const ref = doc(db, "users", input.uid);
      await updateDoc(ref, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(typeof input.teamLeadId !== "undefined"
          ? { teamLeadId: input.teamLeadId, reportsTo: input.teamLeadId } // Sync reportsTo
          : {}),
        ...(typeof input.displayName !== "undefined"
          ? { displayName: input.displayName }
          : {}),
        updatedAt: serverTimestamp(),
      });
    },
    onError: async (_err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(usersKey, ctx.prev);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}
