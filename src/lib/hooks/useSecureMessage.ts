import { useState, useEffect } from 'react';
import { CryptoService, EnvelopeMessage } from '@/lib/encryption/CryptoService';

export function useSecureMessage(
  message: EnvelopeMessage | null,
  currentUserId: string | undefined
) {
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  useEffect(() => {
    if (!message || !currentUserId) return;

    let mounted = true;

    const decrypt = async () => {
      setIsDecrypting(true);
      try {
        const text = await CryptoService.getInstance().decryptMessage(currentUserId, message);
        if (mounted) {
            setDecryptedContent(text);
            setError(null);
        }
      } catch (e: unknown) {
        const isKeyMismatch = e instanceof Error && e.message === "DECRYPTION_FAILED_KEY_MISMATCH";
        
        if (!isKeyMismatch) {
            console.error("Decryption failed", e);
        }

        if (mounted) {
            setError(isKeyMismatch ? "Key Changed (Unreadable)" : "Decryption Failed");
        }
      } finally {
        if (mounted) {
            setIsDecrypting(false);
        }
      }
    };

    decrypt();

    return () => {
      mounted = false;
    };
  }, [message, currentUserId]);

  return { decryptedContent, error, isDecrypting };
}
