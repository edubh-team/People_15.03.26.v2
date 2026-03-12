"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  type Timestamp,
  FirestoreError,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import type { UserDoc } from "@/lib/types/user";
import { serverTimestamp } from "firebase/firestore";

type TaskDoc = {
  id: string;
  assignedTo: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: unknown;
};

function toDate(ts: Timestamp | Date | string | number) {
  return ts && typeof (ts as Timestamp).toDate === "function"
    ? (ts as Timestamp).toDate()
    : new Date(ts as Date | string | number);
}

export default function ProfileUidPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const { firebaseUser, userDoc, refreshUserDoc } = useAuth();
  const viewingUid = useMemo(() => {
    const p = params?.uid;
    if (!p || Array.isArray(p)) return firebaseUser?.uid ?? null;
    return p === "me" ? firebaseUser?.uid ?? null : p;
  }, [params?.uid, firebaseUser?.uid]);

  const [targetUser, setTargetUser] = useState<UserDoc | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"Personal" | "Work" | "Job" | "Leave" | "Performance" | "Permissions">("Personal");
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<{ address: string; alternateEmail: string; alternatePhone: string }>({
    address: "",
    alternateEmail: "",
    alternatePhone: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const [hasWebcam, setHasWebcam] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [usingFront, setUsingFront] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isReview, setIsReview] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const canEditPersonal = useMemo(() => {
    return Boolean(firebaseUser?.uid && viewingUid && firebaseUser.uid === viewingUid);
  }, [firebaseUser?.uid, viewingUid]);

  const canEditWork = useMemo(() => {
    if (!userDoc || !targetUser) return false;
    if (userDoc.role === "admin") return true;
    if (userDoc.role === "teamLead") {
      return targetUser.managerId === userDoc.uid || targetUser.teamLeadId === userDoc.uid;
    }
    return false;
  }, [userDoc, targetUser]);

  const canEditPermissions = canEditWork;

  useEffect(() => {
    if (!db || !viewingUid) return;
    setLoading(true);
    
    const ref = doc(db, "users", viewingUid);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        router.replace("/unauthorized");
        return;
      }
      const data = snap.data() as UserDoc;
      setTargetUser(data);
      // Only set form initial values if it's the first load or we want to sync (usually just first load)
      // But since we want to allow editing, maybe we shouldn't overwrite form state on every update if user is typing?
      // Let's only set form if it's not dirty? Or just set it initially?
      // For now, let's keep the form init logic separate or only runs once? 
      // Actually, if I am editing, I don't want incoming updates to overwrite my inputs.
      // But targetUser update triggers the dirty check effect.
      setLoading(false);
    }, (err) => {
      console.error("Profile fetch error:", err);
      setLoading(false);
    });

    return () => unsub();
  }, [viewingUid, router]);

  // Initialize form when targetUser is first loaded
  useEffect(() => {
    if (targetUser && !dirty) {
       setForm(() => {
         // Only update if values are empty (initial load) or we want to force sync?
         // Better to just set it if we haven't touched it?
         // For simplicity, let's stick to the previous behavior: 
         // The previous behavior was setting it on load().
         // Here we can set it if it matches the "initial" state.
         // Or just use a separate effect that runs only when viewingUid changes?
         // But targetUser is async.
         return {
            address: (targetUser.address ?? targetUser.kycDetails?.address ?? "") || "",
            alternateEmail: targetUser.alternateEmail ?? "",
            alternatePhone: targetUser.alternatePhone ?? "",
         };
       });
    }
  }, [targetUser, dirty]); // Only when UID changes or first load logic? 
  // This is tricky. Let's keep the getDoc for form init if we want, or just be careful.
  // Actually, the previous code only set form on successful getDoc.
  
  // Let's refine the onSnapshot strategy:
  // We want real-time updates for the READ-ONLY parts (Header, Cards).
  // For the Form, we can initialize it once.


  useEffect(() => {
    if (!targetUser) return;
    const nextDirty =
      (targetUser.address ?? "") !== form.address ||
      (targetUser.alternateEmail ?? "") !== form.alternateEmail ||
      (targetUser.alternatePhone ?? "") !== form.alternatePhone;
    setDirty(nextDirty);
  }, [form, targetUser]);

  useEffect(() => {
    if (!db || !targetUser) return;
    const mid = targetUser.managerId ?? targetUser.teamLeadId;
    if (!mid) {
      setManagerName(null);
      return;
    }
    
    // Simple fetch for manager name
    getDoc(doc(db, "users", mid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as UserDoc;
        setManagerName(d.displayName ?? d.email ?? mid);
      } else {
        setManagerName("Unknown User");
      }
    }).catch(err => {
      console.error("Failed to fetch manager name", err);
      setManagerName("Unknown");
    });
  }, [targetUser]);

  const [taskStats, setTaskStats] = useState<{ total: number; completed: number }>({ total: 0, completed: 0 });
  const [leadStats, setLeadStats] = useState<{ total: number }>({ total: 0 });

  useEffect(() => {
    if (!db || !viewingUid) return;
    const tq = query(collection(db, "tasks"), where("assignedTo", "==", viewingUid), limit(400));
    const unsubTasks = onSnapshot(
      tq,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as TaskDoc);
        const total = rows.length;
        const completed = rows.filter((t) => t.status === "completed").length;
        setTaskStats({ total, completed });
      },
      (error: FirestoreError) => {
        if (error.code === "permission-denied") return;
        console.error("Profile tasks listener error", error);
      },
    );
    const lq = query(collection(db, "leads"), where("assignedTo", "==", viewingUid), limit(1000));
    const unsubLeads = onSnapshot(
      lq,
      (snap) => {
        setLeadStats({ total: snap.size });
      },
      (error: FirestoreError) => {
        if (error.code === "permission-denied") return;
        console.error("Profile leads listener error", error);
      },
    );
    return () => {
      unsubTasks();
      unsubLeads();
    };
  }, [viewingUid]);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 640);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    async function detectWebcam() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          setHasWebcam(false);
          return;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setHasWebcam(devices.some((d) => d.kind === "videoinput"));
      } catch {
        setHasWebcam(false);
      }
    }
    void detectWebcam();
  }, []);

  async function onSave() {
    if (!db || !viewingUid || !targetUser) return;
    setIsSaving(true);
    try {
      const ref = doc(db, "users", viewingUid);
      await updateDoc(ref, {
        address: form.address || null,
        alternateEmail: form.alternateEmail || null,
        alternatePhone: form.alternatePhone || null,
      });
      await refreshUserDoc();
      const snap = await getDoc(ref);
      setTargetUser(snap.data() as UserDoc);
    } finally {
      setIsSaving(false);
    }
  }

  async function onUploadPhoto(file: Blob | File) {
    if (!firebaseUser || !db) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setToast("Image must be smaller than 5MB");
      return;
    }

    setPhotoUploading(true);
    try {
      const st = getStorage();
      const key = `profiles/${firebaseUser.uid}/avatar.jpg`;
      const sref = storageRef(st, key);
      await uploadBytes(sref, file);
      const url = await getDownloadURL(sref);
      await updateProfile(firebaseUser, { photoURL: url });
      const uref = doc(db, "users", firebaseUser.uid);
      await updateDoc(uref, { photoURL: url, updatedAt: serverTimestamp() });
      const snap = await getDoc(uref);
      setTargetUser(snap.data() as UserDoc);
      setToast("Profile Updated Successfully.");
    } catch (err) {
      console.error("Upload failed:", err);
      setToast("Failed to upload photo. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function saveToFirebase(input: {
    image?: Blob | File | null;
    personal?: {
      address?: string | null;
      alternateEmail?: string | null;
      alternatePhone?: string | null;
      aadhar?: string | null;
    };
  }) {
    if (!firebaseUser || !db) return;
    if (input.image) {
      await onUploadPhoto(input.image);
    }
    if (input.personal) {
      const uref = doc(db, "users", firebaseUser.uid);
      await updateDoc(uref, {
        address: input.personal.address ?? null,
        alternateEmail: input.personal.alternateEmail ?? null,
        alternatePhone: input.personal.alternatePhone ?? null,
        kycDetails: {
          ...(targetUser?.kycDetails ?? null),
          aadhar: input.personal.aadhar ?? (targetUser?.kycDetails?.aadhar ?? null),
        },
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(uref);
      setTargetUser(snap.data() as UserDoc);
      setToast("Profile Updated Successfully.");
    }
  }

  async function startCamera(facing: "user" | "environment") {
    setCameraError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(s);
      setCameraOpen(true);
      setIsReview(false);
      setCapturedBlob(null);
      const v = videoRef.current;
      if (v) {
        if ("srcObject" in v) {
          (v as HTMLVideoElement & { srcObject: MediaStream | null }).srcObject = s;
        }
        const playPromise = v.play();
        if (playPromise && typeof playPromise.then === "function") {
          await playPromise;
        }
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Camera access denied");
    }
  }

  function stopCamera() {
    const s = stream;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
    }
    setStream(null);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
    }
    setCameraOpen(false);
    setIsReview(false);
    setCapturedBlob(null);
  }

  async function onFlipCamera() {
    const next = !usingFront;
    setUsingFront(next);
    stopCamera();
    await startCamera(next ? "user" : "environment");
  }

  async function onShutter() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    const size = Math.min(w, h);
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sx = (w - size) / 2;
    const sy = (h - size) / 2;
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    const flash = document.getElementById("capture-flash");
    if (flash) {
      flash.classList.remove("opacity-0");
      flash.classList.add("opacity-100");
      window.setTimeout(() => {
        flash.classList.remove("opacity-100");
        flash.classList.add("opacity-0");
      }, 140);
    }
    const blob: Blob | null = await new Promise((resolve) =>
      c.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (blob) {
      setCapturedBlob(blob);
      setIsReview(true);
      const vEl = videoRef.current;
      if (vEl) vEl.pause();
    }
  }

  async function onUseCaptured() {
    if (!capturedBlob) return;
    await saveToFirebase({ image: capturedBlob });
    stopCamera();
    setPhotoMenuOpen(false);
  }

  async function onRemovePhoto() {
    if (!firebaseUser || !db) return;
    await updateProfile(firebaseUser, { photoURL: null });
    const uref = doc(db, "users", firebaseUser.uid);
    await updateDoc(uref, { photoURL: null });
    const snap = await getDoc(uref);
    setTargetUser(snap.data() as UserDoc);
    setPhotoMenuOpen(false);
  }

  function Header() {
    // Display photo from user profile (Firebase Storage or Google)
    const photo = targetUser?.photoURL;

    return (
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-6">
          <div className="relative">
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && canEditPersonal) void onUploadPhoto(f);
                // Reset input so the same file can be selected again
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="group relative block h-24 w-24 overflow-hidden rounded-full border border-slate-200 bg-white"
              onClick={() => setPhotoMenuOpen(true)}
            >
              {photo ? (
                <Image alt="" src={photo} fill className="object-cover" sizes="96px" priority />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-semibold">
                  {(targetUser?.displayName ?? targetUser?.email ?? "U").trim().slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/20 text-xs text-white group-hover:flex">
                Edit
              </div>
            </button>
            {photoUploading ? (
              <div className="absolute -right-1 -top-1 animate-pulse rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                Uploading
              </div>
            ) : null}
            <AnimatePresence>
              {photoMenuOpen && !isMobile ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute left-28 top-0 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white/70 shadow-xl backdrop-blur-xl"
                >
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setPhotoMenuOpen(false);
                      libraryInputRef.current?.click();
                    }}
                  >
                    Choose from Photo Library
                  </button>
                  <button
                    type="button"
                    disabled={!hasWebcam}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => {
                      setPhotoMenuOpen(false);
                      setUsingFront(true);
                      void startCamera("user");
                    }}
                  >
                    Take Photo
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => void onRemovePhoto()}
                  >
                    Remove Current Photo
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <div className="min-w-0">
            <div className="truncate text-2xl font-semibold tracking-tight">
              {targetUser?.displayName ?? "—"}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 font-mono">
                {targetUser?.employeeId || viewingUid || "—"}
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {targetUser?.status === "active" ? "Active" : "Inactive"}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function MobilePhotoMenu() {
    return (
      <AnimatePresence>
        {photoMenuOpen && isMobile ? (
          <motion.div className="fixed inset-0 z-30">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-2xl" onClick={() => setPhotoMenuOpen(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border border-slate-200 bg-white/80 shadow-xl backdrop-blur-xl"
            >
              <div className="px-4 py-2">
                <button
                  type="button"
                  className="block w-full rounded-md px-3 py-3 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setPhotoMenuOpen(false);
                    libraryInputRef.current?.click();
                  }}
                >
                  Choose from Photo Library
                </button>
                <button
                  type="button"
                  disabled={!hasWebcam}
                  className="mt-1 block w-full rounded-md px-3 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => {
                    setPhotoMenuOpen(false);
                    setUsingFront(true);
                    void startCamera("user");
                  }}
                >
                  Take Photo
                </button>
                <button
                  type="button"
                  className="mt-1 block w-full rounded-md px-3 py-3 text-left text-sm text-rose-600 hover:bg-rose-50"
                  onClick={() => void onRemovePhoto()}
                >
                  Remove Current Photo
                </button>
              </div>
              <div className="border-t border-slate-200 px-4 py-3">
                <button
                  type="button"
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => setPhotoMenuOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    );
  }

  function CameraModal() {
    if (!cameraOpen) return null;
    const url = capturedBlob ? URL.createObjectURL(capturedBlob) : null;
    return (
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-2xl" />
        <div className="relative mx-auto mt-8 max-w-xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-xl backdrop-blur-2xl sm:p-6 p-4"
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-sm text-slate-700"
                onClick={() => stopCamera()}
              >
                Cancel
              </button>
              {isMobile ? (
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs hover:bg-slate-50"
                  onClick={() => void onFlipCamera()}
                >
                  Flip
                </button>
              ) : null}
            </div>
            <div className="mt-4">
              <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[24px] border-[4px] border-white bg-black shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
                <div id="capture-flash" className="pointer-events-none absolute inset-0 z-10 bg-white opacity-0 transition-opacity" />
                {isReview && url ? (
                  <Image
                    alt=""
                    src={url}
                    fill
                    className="h-full w-full object-cover"
                    style={{ aspectRatio: 1 }}
                    unoptimized
                  />
                ) : (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="h-full w-full object-cover"
                    style={{ aspectRatio: 1 }}
                    onLoadedMetadata={() => {
                      const v = videoRef.current;
                      if (v) {
                        const p = v.play();
                        if (p && typeof p.then === "function") void p.then(() => {}).catch(() => {});
                      }
                    }}
                  />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </div>
            {cameraError ? (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {cameraError}
              </div>
            ) : null}
            <div className="mt-6 flex items-center justify-center">
              {isReview ? (
                <div className="flex w-full max-w-md items-center justify-between">
                  <button
                    type="button"
                    className="text-sm text-slate-700"
                    onClick={() => {
                      setIsReview(false);
                      const v = videoRef.current;
                      if (v) v.play();
                    }}
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    onClick={() => void onUseCaptured()}
                  >
                    Use Photo
                  </button>
                </div>
              ) : (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="relative h-16 w-16 rounded-full border-4 border-white bg-white shadow-md"
                  onClick={() => void onShutter()}
                >
                  <span className="absolute inset-2 rounded-full bg-white" />
                </motion.button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  function LeftRail() {
    const tabs: Array<typeof tab> = ["Personal", "Work", "Job", "Leave", "Performance", "Permissions"];
    return (
      <aside className="w-64 flex-shrink-0">
        <div className="rounded-[24px] border border-slate-200/60 bg-[#F5F5F7] p-4">
          <div className="text-xs font-semibold tracking-wide text-slate-500">Profile</div>
          <div className="mt-3 space-y-1">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${t === tab ? "bg-white/70 font-semibold shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md" : "text-slate-700 hover:bg-white/50"}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  function PersonalCard() {
    const viewOnly = [
      { label: "Employee ID", value: targetUser?.employeeId || "ID Pending" },
      { label: "First Name", value: (targetUser?.displayName ?? "—").split(" ")[0] ?? "—" },
      { label: "Last Name", value: (targetUser?.displayName ?? "—").split(" ").slice(1).join(" ") || "—" },
      { label: "Primary Email", value: targetUser?.email ?? "—" },
      { label: "Primary Phone", value: targetUser?.phone ?? "—" },
    ];
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Personal Info</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {viewOnly.map((f) => (
            <div key={f.label} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="text-xs text-slate-500">{f.label}</div>
              <div className="mt-1 font-medium">{f.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Address</div>
            <input
              value={form.address}
              onChange={(e) => setForm((v) => ({ ...v, address: e.target.value }))}
              disabled={!canEditPersonal}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Alternate Email</div>
            <input
              value={form.alternateEmail}
              onChange={(e) => setForm((v) => ({ ...v, alternateEmail: e.target.value }))}
              disabled={!canEditPersonal}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-slate-600">Alternate Phone</div>
            <input
              value={form.alternatePhone}
              onChange={(e) => setForm((v) => ({ ...v, alternatePhone: e.target.value }))}
              disabled={!canEditPersonal}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:opacity-60"
            />
          </label>
        </div>
      </div>
    );
  }

  function WorkCard() {
    const rows = [
      { label: "Department", value: "—" },
      { label: "Job Title", value: (targetUser?.orgRole ?? "—").toUpperCase() },
      {
        label: "Date of Hire",
        value: targetUser?.createdAt ? toDate(targetUser.createdAt as Timestamp | Date | string | number).toLocaleDateString() : "—",
      },
      { label: "Reporting To", value: managerName ?? ((targetUser?.managerId || targetUser?.teamLeadId) ? "Loading..." : "—") },
      { label: "Source of Hire", value: "—" },
      {
        label: "Employee Status",
        value: (
          <span className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${targetUser?.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} />
            {targetUser?.status ?? "—"}
          </span>
        ),
      },
    ];
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Work Info</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((f) => (
            <div key={f.label} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="text-xs text-slate-500">{f.label}</div>
              <div className="mt-1 font-medium">{typeof f.value === "string" ? f.value : f.value}</div>
            </div>
          ))}
        </div>
        {canEditWork ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Editing controls for Work Info can be added here.
          </div>
        ) : null}
      </div>
    );
  }

  function JobCard() {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Job</div>
        <div className="mt-3 text-sm text-slate-600">
          Detailed role description and shift timings can be configured by admin.
        </div>
      </div>
    );
  }

  function LeaveCard() {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Leave</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="text-xs text-slate-500">Current Balance</div>
            <div className="mt-1 font-semibold">—</div>
          </div>
          <div className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="text-xs text-slate-500">History</div>
            <div className="mt-1 text-slate-600">—</div>
          </div>
        </div>
      </div>
    );
  }

  function PerformanceCard() {
    const totalTasks = taskStats.total;
    const completedTasks = taskStats.completed;
    const totalLeads = leadStats.total;
    const percent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Performance</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 p-4">
            <div className="text-xs text-slate-500">Tasks Completed</div>
            <div className="mt-1 text-xl font-semibold">
              {completedTasks}/{totalTasks}
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 p-4">
            <div className="text-xs text-slate-500">Leads Owned</div>
            <div className="mt-1 text-xl font-semibold">{totalLeads}</div>
          </div>
          <div className="rounded-lg border border-slate-100 p-4">
            <div className="text-xs text-slate-500">Completion Rate</div>
            <div className="mt-1 text-xl font-semibold">{percent}%</div>
          </div>
        </div>
      </div>
    );
  }

  function PermissionsCard() {
    const levels = ["EMPLOYEE", "MANAGER", "SUPER_ADMIN"];
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold">Permissions</div>
        <div className="mt-3 text-sm">
          <div className="text-xs text-slate-500">Access Level</div>
          <div className="mt-1 inline-flex items-center gap-2">
            {levels.map((l) => (
              <span
                key={l}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  targetUser?.orgRole === l ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
        {canEditPermissions ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Editing controls for Permissions can be added here.
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <AuthGate>
      <div className="min-h-screen bg-white text-slate-900">
        {Header()}
        {MobilePhotoMenu()}
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          {loading ? (
            <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
              <div className="h-48 rounded-[24px] bg-slate-100 animate-pulse" />
              <div className="h-48 rounded-[24px] bg-slate-100 animate-pulse" />
            </div>
          ) : (
            <div className="flex gap-6">
              {LeftRail()}
              <div className="flex-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    initial={{ x: 24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -24, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                    className="space-y-6"
                  >
                    {tab === "Personal" ? PersonalCard() : null}
                    {tab === "Work" ? WorkCard() : null}
                    {tab === "Job" ? JobCard() : null}
                    {tab === "Leave" ? LeaveCard() : null}
                    {tab === "Performance" ? PerformanceCard() : null}
                    {tab === "Permissions" ? PermissionsCard() : null}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
        {CameraModal()}
        {toast ? (
          <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2">
            <div className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm backdrop-blur-md">
              {toast}
            </div>
          </div>
        ) : null}

        {dirty && canEditPersonal ? (
          <div className="fixed bottom-4 left-0 right-0 z-20">
            <div className="mx-auto flex max-w-2xl items-center justify-between rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-md">
              <div className="text-sm text-slate-700">You have unsaved changes</div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => void onSave()}
              >
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                {isSaving ? "Saving…" : "Save Changes"}
              </motion.button>
            </div>
          </div>
        ) : null}
      </div>
    </AuthGate>
  );
}
