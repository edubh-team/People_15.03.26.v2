import React, { useState, useEffect } from 'react';
import { SignalManager } from '@/lib/signal/SignalManager';
import { LockClosedIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface DecryptedMessageProps {
  ciphertext: string;
  senderId: string;
  type?: number; // Signal Message Type (1 or 3)
  className?: string;
}

export const DecryptedMessage: React.FC<DecryptedMessageProps> = ({ 
  ciphertext, 
  senderId, 
  type = 1,
  className 
}) => {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const decrypt = async () => {
      if (!ciphertext || !senderId) return;
      
      try {
        setLoading(true);
        setError(null);
        
        const result = await SignalManager.getInstance().decryptMessage(senderId, ciphertext, type);
        
        if (typeof result === 'object' && 'error' in result) {
            if (mounted) setError(result.error);
        } else {
            if (mounted) setPlaintext(result);
        }
      } catch (e) {
        console.error("Decryption component error:", e);
        if (mounted) setError("DECRYPTION_FAILED");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    decrypt();

    return () => {
      mounted = false;
    };
  }, [ciphertext, senderId, type]);

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-2 text-gray-400 italic ${className}`}>
        <LockClosedIcon className="w-3 h-3 animate-pulse" />
        <span className="text-xs">Decrypting...</span>
      </span>
    );
  }

  if (error) {
    const isSessionError = error === "DECRYPTION_FAILED_SESSION_RESET_NEEDED";
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <span className="inline-flex items-center gap-2 text-red-500 italic text-xs">
          <ExclamationTriangleIcon className="w-4 h-4" />
          {isSessionError ? "Session Broken" : "Decryption Failed"}
        </span>
        {isSessionError && (
            <button 
                onClick={() => window.location.reload()} // Simple reset for now, ideally re-init session
                className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
            >
                <ArrowPathIcon className="w-3 h-3" /> Reset Session
            </button>
        )}
      </div>
    );
  }

  return <span className={`whitespace-pre-wrap break-words ${className}`}>{plaintext}</span>;
};
