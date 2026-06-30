"use client";

import { useEffect, useState } from "react";
import {
  useAttachTodayLocation,
  useCheckIn,
  useCheckOut,
  useEndBreak,
  useMarkOnLeave,
  useStartBreak,
} from "@/lib/hooks/useAttendance";
import type { GeoLocation, PresenceDoc } from "@/lib/types/attendance";

export function useAttendanceActions(
  uid: string | null | undefined,
  todayPresence: PresenceDoc | null | undefined
) {
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const attachLocation = useAttachTodayLocation();
  const startBreak = useStartBreak();
  const endBreak = useEndBreak();
  const onLeave = useMarkOnLeave();

  const [toast, setToast] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    "unknown" | "unsupported" | "denied" | "ready" | "locating" | "ok"
  >("unknown");
  const [lastLocation, setLastLocation] = useState<GeoLocation | null>(null);

  // Clear toast after delay
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Geolocation permission check
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    
    const checkGeo = async () => {
      if (!("geolocation" in navigator)) {
        setGeoStatus("unsupported");
        return;
      }
      if (!("permissions" in navigator)) {
        setGeoStatus("ready");
        return;
      }
      try {
        const r = await (navigator as any).permissions.query({ name: "geolocation" });
        if (r.state === "denied") setGeoStatus("denied");
        else setGeoStatus("ready");
      } catch {
        setGeoStatus("ready");
      }
    };
    
    checkGeo();
  }, []);

  const isBusy =
    checkIn.isPending ||
    checkOut.isPending ||
    attachLocation.isPending ||
    startBreak.isPending ||
    endBreak.isPending ||
    onLeave.isPending ||
    geoStatus === "locating";

  async function handlePrimaryAction() {
    if (!uid) return;
    if (isBusy) return;

    // 1. Check Out if already checked in or on break
    if (todayPresence?.status === "checked_in" || todayPresence?.status === "on_break") {
      checkOut.mutate(
        { uid },
        {
          onSuccess: () => setToast("Checked out successfully"),
          onError: (err) =>
            setToast(err instanceof Error ? err.message : "Error checking out"),
        }
      );
      return;
    }

    // 2. Check In
    if (geoStatus === "denied") {
      setToast("Location permission denied. Please enable it.");
      return;
    }
    if (geoStatus === "unsupported") {
      setToast("Geolocation not supported.");
      return;
    }

    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc: GeoLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setLastLocation(loc);
        setGeoStatus("ok");

        checkIn.mutate(
          { uid },
          {
            onSuccess: () => {
              setToast("Checked in successfully");
              attachLocation.mutate({ uid, location: loc });
            },
            onError: (err: unknown) => {
              setToast(err instanceof Error ? err.message : "Error checking in");
              setGeoStatus("ready");
            },
          }
        );
      },
      (err) => {
        console.warn("Geolocation error:", err.code, err.message);
        setGeoStatus("ready");
        setToast("Could not get location. checking in anyway...");
        // Fallback check-in
        checkIn.mutate(
          { uid },
          {
            onSuccess: () => setToast("Checked in (no location)"),
            onError: (e) =>
              setToast(e instanceof Error ? e.message : "Error checking in"),
          }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function handleBreakAction() {
    if (!uid) return;
    
    if (todayPresence?.status === "on_break") {
      endBreak.mutate(
        { uid },
        {
          onSuccess: () => setToast("Resumed work"),
          onError: (err: unknown) =>
            setToast(err instanceof Error ? err.message : "Error resuming"),
        }
      );
    } else {
      startBreak.mutate(
        { uid },
        {
          onSuccess: () => setToast("On break"),
          onError: (err: unknown) =>
            setToast(err instanceof Error ? err.message : "Error starting break"),
        }
      );
    }
  }

  async function handleLeaveAction() {
    if (!uid) return;
    onLeave.mutate(
      { uid },
      {
        onSuccess: () => setToast("Marked on leave"),
        onError: (err: unknown) =>
          setToast(err instanceof Error ? err.message : "Error marking on leave"),
      }
    );
  }

  return {
    handlePrimaryAction,
    handleBreakAction,
    handleLeaveAction,
    isBusy,
    toast,
    setToast,
    geoStatus,
    setGeoStatus,
    lastLocation,
  };
}
