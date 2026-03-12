import React, { Fragment, useState } from 'react';
import { Dialog, Transition, TransitionChild, DialogPanel, DialogTitle } from '@headlessui/react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BackupService } from '@/lib/signal/BackupService';
import { ArrowPathIcon, ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({ isOpen, onClose }) => {
  const { firebaseUser } = useAuth();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);

  const handleBackup = async () => {
    if (!firebaseUser || !pin) return;
    if (pin.length < 4) {
        setStatus({ type: 'error', message: 'PIN must be at least 4 characters.' });
        return;
    }

    setLoading(true);
    setStatus(null);
    try {
      await BackupService.createBackup(firebaseUser.uid, pin);
      setStatus({ type: 'success', message: 'Backup created successfully!' });
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: 'Failed to create backup.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!firebaseUser || !pin) return;
    setLoading(true);
    setStatus(null);
    try {
      await BackupService.restoreBackup(firebaseUser.uid, pin);
      setStatus({ type: 'success', message: 'Keys restored! Please refresh the page.' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: 'Failed to restore. Check your PIN.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <DialogTitle
                  as="h3"
                  className="text-lg font-medium leading-6 text-gray-900 flex items-center gap-2"
                >
                  <ShieldCheckIcon className="w-6 h-6 text-blue-500" />
                  Security & Backup
                </DialogTitle>
                
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Secure your encryption keys with a PIN. This allows you to recover your messages on a new device.
                  </p>
                </div>

                <div className="mt-4 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Backup PIN</label>
                        <input 
                            type="password" 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="Enter 4+ digit PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                        />
                    </div>

                    {status && (
                        <div className={`text-xs p-2 rounded ${
                            status.type === 'success' ? 'bg-green-100 text-green-700' : 
                            status.type === 'error' ? 'bg-red-100 text-red-700' : 
                            'bg-blue-100 text-blue-700'
                        }`}>
                            {status.message}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleBackup}
                            disabled={loading || !pin}
                            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                        >
                            {loading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ShieldCheckIcon className="w-4 h-4" />}
                            Backup Keys
                        </button>
                        <button
                            onClick={handleRestore}
                            disabled={loading || !pin}
                            className="flex-1 bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                        >
                            {loading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ArrowPathIcon className="w-4 h-4" />}
                            Restore
                        </button>
                    </div>

                    <div className="bg-yellow-50 p-3 rounded-lg flex items-start gap-2 text-xs text-yellow-800">
                        <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <p>
                            Warning: Restoring will overwrite your current keys. Only do this if you have lost access or are setting up a new device.
                        </p>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    onClick={onClose}
                  >
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
