import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { KeyPairManager } from '@/lib/encryption/KeyPairManager';

export function useKeyInitialization() {
  const { firebaseUser } = useAuth();
  const [isInitializing, setIsInitializing] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;

    let mounted = true;

    const initKeys = async () => {
      try {
        setIsInitializing(true);
        // Ensure RSA-OAEP Key Pair exists and Public Key is in Firestore
        await KeyPairManager.getInstance().ensureKeyPairExists(firebaseUser.uid);
        if (mounted) setIsReady(true);
      } catch (e) {
        console.error("Failed to initialize Encryption keys:", e);
      } finally {
        if (mounted) setIsInitializing(false);
      }
    };

    initKeys();

    return () => {
      mounted = false;
    };
  }, [firebaseUser]);

  return { isInitializing, isReady };
}
