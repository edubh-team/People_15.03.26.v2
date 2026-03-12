type UserLifecycleLike =
  | {
      status?: string | null;
      isActive?: boolean | null;
      lifecycleState?: string | null;
      inactiveUntil?: unknown;
    }
  | null
  | undefined;

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function normalizeUserStatus(status: unknown): "active" | "inactive" | "terminated" {
  const normalized = normalizeToken(status);
  if (normalized === "terminated") return "terminated";
  if (normalized === "inactive") return "inactive";
  return "active";
}

export function toDateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveUserOperationalState(user: UserLifecycleLike, now = new Date()) {
  if (!user) {
    return {
      normalizedStatus: "inactive" as const,
      lifecycleState: "inactive" as const,
      isOperational: false,
      isTemporaryInactive: false,
      isInactiveTillExpired: false,
      inactiveUntil: null as Date | null,
    };
  }

  const normalizedStatus = normalizeUserStatus(user.status);
  const lifecycleToken = normalizeToken(user.lifecycleState);
  const inactiveUntil = toDateOrNull(user.inactiveUntil);
  const inactiveTillExpired =
    lifecycleToken === "inactive_till" &&
    inactiveUntil != null &&
    inactiveUntil.getTime() <= now.getTime();

  if (normalizedStatus === "terminated" || lifecycleToken === "terminated") {
    return {
      normalizedStatus: "terminated" as const,
      lifecycleState: "terminated" as const,
      isOperational: false,
      isTemporaryInactive: false,
      isInactiveTillExpired: false,
      inactiveUntil,
    };
  }

  if (normalizedStatus === "inactive" || user.isActive === false) {
    if (inactiveTillExpired) {
      return {
        normalizedStatus: "active" as const,
        lifecycleState: "active" as const,
        isOperational: true,
        isTemporaryInactive: false,
        isInactiveTillExpired: true,
        inactiveUntil,
      };
    }
    return {
      normalizedStatus: "inactive" as const,
      lifecycleState: lifecycleToken === "inactive_till" ? ("inactive_till" as const) : ("deactivated" as const),
      isOperational: false,
      isTemporaryInactive: lifecycleToken === "inactive_till",
      isInactiveTillExpired: false,
      inactiveUntil,
    };
  }

  return {
    normalizedStatus: "active" as const,
    lifecycleState: "active" as const,
    isOperational: user.isActive == null ? true : user.isActive,
    isTemporaryInactive: false,
    isInactiveTillExpired: false,
    inactiveUntil,
  };
}

export function canUserOperate(user: UserLifecycleLike, now = new Date()) {
  return resolveUserOperationalState(user, now).isOperational;
}
