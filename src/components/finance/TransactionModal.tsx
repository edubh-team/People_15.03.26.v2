"use client";

import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition, Listbox } from "@headlessui/react";
import { XMarkIcon, CloudArrowUpIcon, CheckIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { storage } from "@/lib/firebase/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  TransactionCategory,
  PaymentMode,
  type FinanceAccountDirectoryResponse,
  type FinanceTransactionMutationResponse,
} from "@/lib/types/finance";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result?: FinanceTransactionMutationResponse) => void;
}

const CREDIT_CATEGORIES: TransactionCategory[] = [
  "University Name",
  "Family Fund",
  "Investors Fund",
  "Donation",
  "Loan",
];
const DEBIT_CATEGORIES: TransactionCategory[] = [
  "FREELANCER",
  "EMI",
  "MARKETING",
  "OFFICE EXPENSES",
  "Traveling Expenses",
  "Advance salary",
  "Bonus",
  // Legacy categories retained for historic workflows.
  "Rent",
  "Salaries",
  "Petty Cash",
  "Infra",
  "Marketing",
  "Others",
];
const PAYMENT_MODES: PaymentMode[] = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CREDIT', 'CREDIT CARD', 'LOAN', 'CHEQUE', 'CASH'];

const MONTH_BASED_DEBIT_CATEGORIES: TransactionCategory[] = ["EMI", "MARKETING", "Marketing"];
const BENEFICIARY_DEBIT_CATEGORIES: TransactionCategory[] = [
  "FREELANCER",
  "OFFICE EXPENSES",
  "Traveling Expenses",
  "Advance salary",
  "Bonus",
  "Rent",
  "Infra",
];
const EXTERNAL_CREDIT_CATEGORIES: TransactionCategory[] = [
  "Family Fund",
  "Investors Fund",
  "Donation",
  "Investment",
];

interface SelectOption {
  id: string;
  name: string;
  type: 'EMPLOYEE' | 'EXTERNAL' | 'OTHER';
}

export default function TransactionModal({ isOpen, onClose, onSuccess }: Props) {
  const { firebaseUser } = useAuth();
  const [type, setType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<TransactionCategory>('University Name');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('NEFT');
  const [chequeNo, setChequeNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New State for "To" field
  const [employees, setEmployees] = useState<SelectOption[]>([]);
  const [externals, setExternals] = useState<SelectOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  
  // Selection State
  const [selectedEmployees, setSelectedEmployees] = useState<SelectOption[]>([]);
  const [selectedExternal, setSelectedExternal] = useState<SelectOption | null>(null);
  const [otherDetails, setOtherDetails] = useState("");
  const [salaryMonth, setSalaryMonth] = useState("");
  const [revenueSource, setRevenueSource] = useState<'UNIVERSITY' | 'OTHER'>('UNIVERSITY');
  const [selectedUniversity, setSelectedUniversity] = useState<'Manipal' | 'Jain' | 'Sharda' | ''>(''); 
  const [loanBankName, setLoanBankName] = useState("");
  const [loanInterestRate, setLoanInterestRate] = useState("");

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const currentYear = new Date().getFullYear();
  const monthOptions = months.map(m => `${m} ${currentYear}`);
  // Add previous year December if currently January
  if (new Date().getMonth() === 0) {
     monthOptions.unshift(`December ${currentYear - 1}`);
  }

  // Fetch Data
  useEffect(() => {
    if (!isOpen || !firebaseUser) return;

    let cancelled = false;
    setAccountsLoading(true);

    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/finance/accounts", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        const data = (await res.json()) as
          | FinanceAccountDirectoryResponse
          | { error?: string };

        if (!res.ok) {
          const message = "error" in data ? data.error : undefined;
          throw new Error(message || "Failed to load finance accounts");
        }

        if (cancelled) return;

        const payload = data as FinanceAccountDirectoryResponse;
        setEmployees(
          payload.items
            .filter((item) => item.type === "EMPLOYEE")
            .map((item) => ({
              id: item.id,
              name: item.name,
              type: "EMPLOYEE" as const,
            })),
        );
        setExternals(
          payload.items
            .filter((item) => item.type === "EXTERNAL")
            .map((item) => ({
              id: item.id,
              name: item.name,
              type: "EXTERNAL" as const,
            })),
        );
      } catch (err: any) {
        if (!cancelled) {
          console.error(err);
          setError(err.message || "Failed to load finance accounts");
        }
      } finally {
        if (!cancelled) {
          setAccountsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, firebaseUser]);

  useEffect(() => {
    setSelectedEmployees([]);
    setSelectedExternal(null);
    setOtherDetails("");
    setSalaryMonth("");
    setLoanBankName("");
    setLoanInterestRate("");
  }, [category, type]);

  useEffect(() => {
    if (type === 'CREDIT' && !CREDIT_CATEGORIES.includes(category)) {
      setCategory('University Name');
      setRevenueSource('UNIVERSITY');
      setSelectedUniversity('');
    } else if (type === 'DEBIT' && !DEBIT_CATEGORIES.includes(category)) {
      setCategory('FREELANCER');
    }
  }, [type, category]); 

  const handleSelectAllEmployees = () => {
    if (selectedEmployees.length === employees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(employees);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);

    // Validation
    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid positive amount.");
      setLoading(false);
      return;
    }
    if (!date) {
      setError("Please select a date.");
      setLoading(false);
      return;
    }
    if (paymentMode === 'CHEQUE' && (!chequeNo || chequeNo.trim() === "")) {
      setError("Please enter the Cheque Number.");
      setLoading(false);
      return;
    }

    // "To" Field Validation
    let toUserPayload = null;
    if (type === 'DEBIT') {
      if (category === 'Salaries') {
        if (selectedEmployees.length === 0) {
          setError("Please select at least one employee.");
          setLoading(false);
          return;
        }
        if (!salaryMonth) {
          setError("Please select the salary month.");
          setLoading(false);
          return;
        }
        toUserPayload = selectedEmployees.map(emp => ({
          id: emp.id,
          name: emp.name,
          type: 'EMPLOYEE'
        }));
      } else if (BENEFICIARY_DEBIT_CATEGORIES.includes(category)) {
        if (!selectedExternal) {
          setError("Please select a beneficiary.");
          setLoading(false);
          return;
        }
        if (selectedExternal.type === 'OTHER' && !otherDetails.trim()) {
          setError("Please specify details for 'Other'.");
          setLoading(false);
          return;
        }
        toUserPayload = {
          id: selectedExternal.id,
          name: selectedExternal.name,
          type: selectedExternal.type,
          otherDetails: selectedExternal.type === 'OTHER' ? otherDetails : undefined
        };
      } else if (MONTH_BASED_DEBIT_CATEGORIES.includes(category)) {
        if (!salaryMonth) {
          setError(category === 'EMI' ? "Please select the EMI month." : "Please select the month.");
          setLoading(false);
          return;
        }
      } else if (category === 'Others') {
        if (!otherDetails.trim()) {
          setError("Please specify the details for Others.");
          setLoading(false);
          return;
        }
        toUserPayload = {
          id: 'other',
          name: 'OTHERS',
          type: 'OTHER',
          otherDetails
        };
      }
    } else if (type === 'CREDIT') {
      if (category === 'University Name' || category === 'Revenue') {
        if (revenueSource === 'UNIVERSITY') {
          if (!selectedUniversity) {
            setError("Please select the University.");
            setLoading(false);
            return;
          }
          toUserPayload = {
            id: selectedUniversity.toLowerCase(),
            name: selectedUniversity,
            type: 'EXTERNAL'
          };
        } else {
          if (!selectedExternal) {
            setError("Please select a payer.");
            setLoading(false);
            return;
          }
          if (selectedExternal.type === 'OTHER' && !otherDetails.trim()) {
            setError("Please specify details for 'Other'.");
            setLoading(false);
            return;
          }
          toUserPayload = {
            id: selectedExternal.id,
            name: selectedExternal.name,
            type: selectedExternal.type,
            otherDetails: selectedExternal.type === 'OTHER' ? otherDetails : undefined
          };
        }
      } else if (EXTERNAL_CREDIT_CATEGORIES.includes(category)) {
        if (!selectedExternal) {
          setError("Please select the 'From' payer.");
          setLoading(false);
          return;
        }
        if (selectedExternal.id === 'other' && !otherDetails.trim()) {
          setError("Please specify details for 'Other'.");
          setLoading(false);
          return;
        }
        toUserPayload = {
          id: selectedExternal.id,
          name: selectedExternal.name,
          type: selectedExternal.type,
          otherDetails: selectedExternal.type === 'OTHER' ? otherDetails : undefined
        };
      } else if (category === 'Loan') {
        if (!loanBankName.trim()) {
          setError("Please enter the Bank Name for the loan.");
          setLoading(false);
          return;
        }
        const rateNum = Number(loanInterestRate);
        if (isNaN(rateNum) || rateNum <= 0) {
          setError("Please enter a valid positive interest rate.");
          setLoading(false);
          return;
        }
        toUserPayload = {
          id: loanBankName.toLowerCase().replace(/\s+/g, '-'),
          name: loanBankName.trim(),
          type: 'EXTERNAL'
        };
      }
    }

    try {
      let proofUrl = null;
      if (file) {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const fileName = `${Date.now()}_${file.name}`;
        const path = `finance_docs/${year}/${month}/${fileName}`;
        const storageRef = ref(storage!, path);
        await uploadBytes(storageRef, file);
        proofUrl = await getDownloadURL(storageRef);
      }

      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/finance/transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          type,
          amount: Number(amount),
          category,
          paymentMode,
          chequeNo: paymentMode === 'CHEQUE' ? chequeNo : undefined,
          date,
          remarks,
          approvalReason,
          proofUrl,
          toUser: toUserPayload,
          salaryMonth:
            category === "Salaries" || MONTH_BASED_DEBIT_CATEGORIES.includes(category)
              ? salaryMonth
              : undefined,
          loanBankName: category === 'Loan' ? loanBankName.trim() : undefined,
          loanInterestRate: category === 'Loan' ? Number(loanInterestRate) : undefined
        })
      });

      const data = (await res.json()) as FinanceTransactionMutationResponse | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in data && data.error) || "Transaction failed");
      }

      // Reset
      setAmount("");
      setRemarks("");
      setApprovalReason("");
      setFile(null);
      setType("CREDIT");
      setPaymentMode("NEFT");
      setChequeNo("");
      setDate(new Date().toISOString().split('T')[0]);
      onSuccess(data as FinanceTransactionMutationResponse);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const otherOption: SelectOption = { id: 'other', name: 'OTHERS', type: 'OTHER' };
  const externalOptions = [...externals, otherOption];

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
              <Dialog.Panel className="w-full max-w-md transform overflow-visible rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex justify-between items-center mb-6">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-slate-900">
                    New Transaction
                  </Dialog.Title>
                  <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
                      {error}
                    </div>
                  )}
                  {accountsLoading && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      Loading finance directory...
                    </div>
                  )}

                  {/* Toggle Switch */}
                  <div className="flex rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setType('CREDIT')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                        type === 'CREDIT' 
                          ? 'bg-white text-emerald-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Income (Credit)
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('DEBIT')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                        type === 'DEBIT' 
                          ? 'bg-white text-rose-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Expense (Debit)
                    </button>
                  </div>

                  {/* Amount & Date */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-slate-400">₹</span>
                        <input
                          type="number"
                          required
                          min="1"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-600"
                      />
                    </div>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as TransactionCategory)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    >
                      {type === 'CREDIT'
                        ? CREDIT_CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))
                        : DEBIT_CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))
                      }
                    </select>
                  </div>

                  {/* University Revenue (Credit) */}
                  {type === 'CREDIT' && category === 'University Name' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">University</label>
                      <select
                        value={selectedUniversity}
                        onChange={(e) => setSelectedUniversity(e.target.value as typeof selectedUniversity)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                      >
                        <option value="">Select university</option>
                        <option value="Manipal">Manipal</option>
                        <option value="Jain">Jain</option>
                        <option value="Sharda">Sharda</option>
                      </select>
                    </div>
                  )}

                  {/* Credit Source / Payer */}
                  {type === 'CREDIT' && EXTERNAL_CREDIT_CATEGORIES.includes(category) && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">From (Payer)</label>
                        <Listbox value={selectedExternal} onChange={setSelectedExternal}>
                          <div className="relative mt-1">
                            <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-slate-200 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm">
                              <span className="block truncate">
                                {selectedExternal ? selectedExternal.name : "Select payer..."}
                              </span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronUpDownIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50">
                                {externalOptions.map((person, personIdx) => (
                                  <Listbox.Option
                                    key={personIdx}
                                    className={({ active }) =>
                                      `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                        active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-900'
                                      }`
                                    }
                                    value={person}
                                  >
                                    {({ selected }) => (
                                      <>
                                        <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                          {person.name}
                                        </span>
                                        {selected ? (
                                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                          </span>
                                        ) : null}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                      {selectedExternal?.id === 'other' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Specify</label>
                          <input
                            type="text"
                            value={otherDetails}
                            onChange={(e) => setOtherDetails(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="Enter payer details"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Loan (Credit) Details */}
                  {type === 'CREDIT' && category === 'Loan' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Bank Name</label>
                        <input
                          type="text"
                          value={loanBankName}
                          onChange={(e) => setLoanBankName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                          placeholder="e.g., HDFC Bank"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Interest Rate (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={loanInterestRate}
                          onChange={(e) => setLoanInterestRate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                          placeholder="e.g., 12.5"
                        />
                      </div>
                    </div>
                  )}
                  {/* Conditional 'To' Field */}
                  {type === 'DEBIT' && (
                    <>
                      {category === 'Salaries' && (
                        <div className="space-y-3">
                          <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">To (Employees)</label>
                          <Listbox value={selectedEmployees} onChange={setSelectedEmployees} multiple>
                            <div className="relative mt-1">
                              <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-slate-200 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm">
                                <span className="block truncate">
                                  {selectedEmployees.length === 0 
                                    ? "Select employees..." 
                                    : `${selectedEmployees.length} selected`}
                                </span>
                                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                  <ChevronUpDownIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                                </span>
                              </Listbox.Button>
                              <Transition
                                as={Fragment}
                                leave="transition ease-in duration-100"
                                leaveFrom="opacity-100"
                                leaveTo="opacity-0"
                              >
                                <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50">
                                  <div className="px-2 py-1 sticky top-0 bg-white border-b border-slate-100 z-10">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.preventDefault(); handleSelectAllEmployees(); }}
                                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800 w-full text-left"
                                    >
                                      {selectedEmployees.length === employees.length ? "Deselect All" : "Select All"}
                                    </button>
                                  </div>
                                  {employees.map((person, personIdx) => (
                                    <Listbox.Option
                                      key={personIdx}
                                      className={({ active }) =>
                                        `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                          active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-900'
                                        }`
                                      }
                                      value={person}
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                            {person.name}
                                          </span>
                                          {selected ? (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                                              <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                            </span>
                                          ) : null}
                                        </>
                                      )}
                                    </Listbox.Option>
                                  ))}
                                </Listbox.Options>
                              </Transition>
                            </div>
                          </Listbox>
                          </div>
                          
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">For the Month of</label>
                            <select
                              value={salaryMonth}
                              onChange={(e) => setSalaryMonth(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                            >
                              <option value="">Select Month</option>
                              {monthOptions.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {MONTH_BASED_DEBIT_CATEGORIES.includes(category) && (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">For the Month of</label>
                          <select
                            value={salaryMonth}
                            onChange={(e) => setSalaryMonth(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                          >
                            <option value="">Select Month</option>
                            {monthOptions.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {BENEFICIARY_DEBIT_CATEGORIES.includes(category) && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">To (Beneficiary)</label>
                            <Listbox value={selectedExternal} onChange={setSelectedExternal}>
                              <div className="relative mt-1">
                                <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-slate-200 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm">
                                  <span className="block truncate">
                                    {selectedExternal ? selectedExternal.name : "Select beneficiary..."}
                                  </span>
                                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                    <ChevronUpDownIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                                  </span>
                                </Listbox.Button>
                                <Transition
                                  as={Fragment}
                                  leave="transition ease-in duration-100"
                                  leaveFrom="opacity-100"
                                  leaveTo="opacity-0"
                                >
                                  <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50">
                                    {externalOptions.map((person, personIdx) => (
                                      <Listbox.Option
                                        key={personIdx}
                                        className={({ active }) =>
                                          `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                            active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-900'
                                          }`
                                        }
                                        value={person}
                                      >
                                        {({ selected }) => (
                                          <>
                                            <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                              {person.name}
                                            </span>
                                            {selected ? (
                                              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                                                <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                              </span>
                                            ) : null}
                                          </>
                                        )}
                                      </Listbox.Option>
                                    ))}
                                  </Listbox.Options>
                                </Transition>
                              </div>
                            </Listbox>
                          </div>

                          {selectedExternal?.type === 'OTHER' && (
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Specify Details <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                required
                                value={otherDetails}
                                onChange={(e) => setOtherDetails(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                placeholder="Enter name/details"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {category === 'Others' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Specify Details <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            required
                            value={otherDetails}
                            onChange={(e) => setOtherDetails(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            placeholder="Enter details for Others"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Payment Mode</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    >
                      {PAYMENT_MODES.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  {/* Cheque Number (Conditional) */}
                  {paymentMode === 'CHEQUE' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Cheque Number <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        required
                        value={chequeNo}
                        onChange={(e) => setChequeNo(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="Enter Cheque No."
                      />
                    </div>
                  )}

                  {/* Remarks */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Remarks (Optional)</label>
                    <textarea
                      rows={2}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="Enter details..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Approval Note (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={approvalReason}
                      onChange={(e) => setApprovalReason(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="Add business context for sensitive transactions"
                    />
                  </div>

                  {/* File Upload */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Proof (Optional)</label>
                    <div className="relative border-2 border-dashed border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors text-center cursor-pointer">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="flex flex-col items-center gap-1">
                        <CloudArrowUpIcon className="h-6 w-6 text-slate-400" />
                        <span className="text-xs text-slate-500">
                          {file ? file.name : "Click to upload Image/PDF"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <button
                      type="submit"
                      disabled={loading}
                      className={`w-full py-2.5 px-4 rounded-xl text-white font-medium shadow-lg shadow-indigo-500/20 transition-all ${
                        loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-500/30'
                      }`}
                    >
                      {loading ? 'Processing...' : 'Submit Transaction'}
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
