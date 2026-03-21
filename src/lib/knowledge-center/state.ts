import type { CanonicalRole } from "@/lib/access";
import { resolveGuideRole } from "@/lib/knowledge-center/content";

const DONE_KEY_PREFIX = "ui.guidedTour.done.";
export const GUIDED_TOUR_FORCE_START_KEY = "ui.guidedTour.forceStart";

export function getGuidedTourDoneStorageKey(role: CanonicalRole) {
  return `${DONE_KEY_PREFIX}${resolveGuideRole(role)}`;
}

export function isGuidedTourCompleted(role: CanonicalRole) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(getGuidedTourDoneStorageKey(role)) === "1";
  } catch {
    return false;
  }
}

export function markGuidedTourCompleted(role: CanonicalRole) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getGuidedTourDoneStorageKey(role), "1");
  } catch {}
}

export function clearGuidedTourCompletion(role: CanonicalRole) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getGuidedTourDoneStorageKey(role));
  } catch {}
}
