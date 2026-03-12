import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SignalIdentityManager } from "@/lib/signal/SignalIdentityManager";

export function useE2EEInitialization() {
  const { firebaseUser, isLoading: authLoading } = useAuth();
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const setupPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    // If auth is loading or no user, reset state
    if (authLoading) return;
    
    if (!firebaseUser) {
      setIsReady(false);
      setIsSettingUp(false);
      setupPromiseRef.current = null;
      return;
    }

    // If already ready for this user, do nothing (optional optimization, but strict check is safer)
    // However, we rely on the effect dependency on firebaseUser.uid
    
    const init = async () => {
      // Prevent double execution
      if (setupPromiseRef.current) return setupPromiseRef.current;

      setIsSettingUp(true);
      try {
        setupPromiseRef.current = SignalIdentityManager.getInstance().ensureIdentityExists(firebaseUser.uid);
        await setupPromiseRef.current;
        setIsReady(true);
      } catch (err) {
        console.error("[useE2EEInitialization] Failed to setup E2EE identity:", err);
      } finally {
        setIsSettingUp(false);
        setupPromiseRef.current = null;
      }
    };

    init();
  }, [firebaseUser, authLoading]);

  return { isSettingUp, isReady };
}
