import React, { useState, useEffect } from 'react';
import { SignalManager } from '@/lib/signal/SignalManager';
import { ExclamationTriangleIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface DecryptedImageProps {
  ciphertext: string;
  senderId: string;
  type?: number;
  className?: string;
  alt?: string;
}

export const DecryptedImage: React.FC<DecryptedImageProps> = ({ 
  ciphertext, 
  senderId, 
  type = 1,
  className,
  alt = "Decrypted Image"
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
            if (mounted) setImageUrl(result);
        }
      } catch (e) {
        console.error("Decryption image error:", e);
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
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg h-48 w-48 ${className}`}>
        <PhotoIcon className="w-8 h-8 text-gray-400 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-red-50 rounded-lg h-48 w-48 border border-red-100 ${className}`}>
        <div className="flex flex-col items-center gap-1 text-red-400">
            <ExclamationTriangleIcon className="w-6 h-6" />
            <span className="text-xs">Failed</span>
        </div>
      </div>
    );
  }

  return <img src={imageUrl || ''} alt={alt} className={`rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity mt-1 border border-black/10 ${className}`} onClick={() => window.open(imageUrl || '', '_blank')} />;
};
