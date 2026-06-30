export type AuthProviderType = "google" | "email";

type ProviderDataLike = {
  providerId?: string | null;
  uid?: string | null;
};

const GOOGLE_PROVIDER_ID = "google.com";
const EMAIL_PROVIDER_IDS = new Set(["password", "email", "emailLink"]);

export function normalizeAuthProvider(value: unknown): AuthProviderType | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "google" || normalized === GOOGLE_PROVIDER_ID) {
    return "google";
  }

  if (
    normalized === "email" ||
    normalized === "password" ||
    normalized === "email/password"
  ) {
    return "email";
  }

  return null;
}

export function inferAuthProviderFromProviderData(
  providerData: ProviderDataLike[] | null | undefined,
): AuthProviderType {
  if (providerData?.some((provider) => provider.providerId === GOOGLE_PROVIDER_ID)) {
    return "google";
  }

  if (providerData?.some((provider) => provider.providerId && EMAIL_PROVIDER_IDS.has(provider.providerId))) {
    return "email";
  }

  return "email";
}

export function getGoogleProviderUid(
  providerData: ProviderDataLike[] | null | undefined,
): string | null {
  const provider = providerData?.find((entry) => entry.providerId === GOOGLE_PROVIDER_ID);
  return provider?.uid?.trim() || null;
}

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeOptionalEmailAddress(email: string | null | undefined) {
  if (typeof email !== "string") return null;
  const normalized = normalizeEmailAddress(email);
  return normalized || null;
}
