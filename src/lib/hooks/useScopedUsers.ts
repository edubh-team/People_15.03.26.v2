import { useEffect, useState } from "react";
import {
  collection,
  limit as fbLimit,
  onSnapshot,
  query,
  type DocumentData,
} from "firebase/firestore";
import { isAdminUser, isHrUser } from "@/lib/access";
import { db } from "@/lib/firebase/client";
import { canReadSalesScope, getHierarchyScopedUsers } from "@/lib/sales/hierarchy";
import type { UserDoc } from "@/lib/types/user";

type UseScopedUsersOptions = {
  includeCurrentUser?: boolean;
  includeInactive?: boolean;
};

type ScopedUsersState = {
  users: UserDoc[];
  loading: boolean;
  error: Error | null;
};

const GLOBAL_USER_LIMIT = 1500;

function isActiveUser(user: UserDoc) {
  return (user.status ?? "").toLowerCase() !== "terminated" && user.isActive !== false;
}

function sortUsers(users: UserDoc[]) {
  return [...users].sort((left, right) => {
    const leftLabel = left.displayName ?? left.name ?? left.email ?? left.uid;
    const rightLabel = right.displayName ?? right.name ?? right.email ?? right.uid;
    return leftLabel.localeCompare(rightLabel);
  });
}

function toUserDoc(snapshot: { id: string; data: () => DocumentData }) {
  return { ...(snapshot.data() as UserDoc), uid: snapshot.id } as UserDoc;
}

export function useScopedUsers(
  currentUser: UserDoc | null,
  options: UseScopedUsersOptions = {},
): ScopedUsersState {
  const { includeCurrentUser = false, includeInactive = false } = options;
  const [state, setState] = useState<ScopedUsersState>({
    users: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!currentUser || !db) {
      setState({ users: [], loading: false, error: null });
      return;
    }

    const firestore = db;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const unsubscribe = onSnapshot(
      query(collection(firestore, "users"), fbLimit(GLOBAL_USER_LIMIT)),
      (snapshot) => {
        const allUsers = snapshot.docs.map((doc) => toUserDoc(doc));
        const scoped = new Map<string, UserDoc>();

        const workingUsers = allUsers.some((user) => user.uid === currentUser.uid)
          ? allUsers
          : [currentUser, ...allUsers];

        if (isAdminUser(currentUser)) {
          workingUsers.forEach((user) => scoped.set(user.uid, user));
        } else if (isHrUser(currentUser)) {
          workingUsers
            .filter((user) => user.assignedHR === currentUser.uid)
            .forEach((user) => scoped.set(user.uid, user));
        } else if (canReadSalesScope(currentUser)) {
          getHierarchyScopedUsers(currentUser, workingUsers, {
            includeCurrentUser,
          }).forEach((user) => scoped.set(user.uid, user));
        } else if (includeCurrentUser) {
          scoped.set(currentUser.uid, currentUser);
        }

        if (includeCurrentUser) {
          scoped.set(currentUser.uid, currentUser);
        }

        let rows = Array.from(scoped.values());
        if (!includeInactive) {
          rows = rows.filter(isActiveUser);
        }
        if (!includeCurrentUser) {
          rows = rows.filter((user) => user.uid !== currentUser.uid);
        }

        setState({
          users: sortUsers(rows),
          loading: false,
          error: null,
        });
      },
      (error) => {
        setState((previous) => ({
          ...previous,
          loading: false,
          error:
            error instanceof Error ? error : new Error("Unable to load scoped users"),
        }));
      },
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser, includeCurrentUser, includeInactive]);

  return state;
}
