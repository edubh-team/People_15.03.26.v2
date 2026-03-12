"use client";

import { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { normalizeAccountNumber, normalizeIfscCode, normalizePhone } from "@/lib/finance/accountDirectory";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPersonModal({ isOpen, onClose, onSuccess }: Props) {
  const { firebaseUser } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);

    const normalizedName = name.trim();
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
    const normalizedIfsc = normalizeIfscCode(ifscCode);

    if (!normalizedName || !normalizedPhone || !normalizedEmail || !normalizedAccountNumber || !normalizedIfsc) {
      setError("All fields are required.");
      setLoading(false);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      setLoading(false);
      return;
    }

    if (!/^[+\d][\d\s-]{6,}$/.test(normalizedPhone)) {
      setError("Enter a valid phone number.");
      setLoading(false);
      return;
    }

    if (!/^\d{6,20}$/.test(normalizedAccountNumber)) {
      setError("Account number must be 6-20 digits.");
      setLoading(false);
      return;
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      setError("Enter a valid IFSC code.");
      setLoading(false);
      return;
    }

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/finance/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          name: normalizedName,
          phone: normalizedPhone,
          email: normalizedEmail,
          accountNumber: normalizedAccountNumber,
          ifscCode: normalizedIfsc,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add person");

      // Reset
      setName("");
      setPhone("");
      setEmail("");
      setAccountNumber("");
      setIfscCode("");
      
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex justify-between items-center mb-6">
                  <Dialog.Title as="h3" className="text-lg font-bold text-slate-900">
                    Add New Account Person
                  </Dialog.Title>
                  <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 transition-colors">
                    <XMarkIcon className="w-6 h-6 text-slate-500" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
                      {error}
                    </div>
                  )}

                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700">
                    New banking records are validated on entry and masked by default inside the
                    finance directory.
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      placeholder="Enter full name"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        placeholder="Enter phone"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Email ID</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        placeholder="Enter email"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Account Number</label>
                    <input
                      type="text"
                      required
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                      placeholder="Enter account number"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">IFSC Code</label>
                    <input
                      type="text"
                      required
                      value={ifscCode}
                      onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono uppercase"
                      placeholder="Enter IFSC code"
                    />
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? "Adding..." : "Add Person"}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
