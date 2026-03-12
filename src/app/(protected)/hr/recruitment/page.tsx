"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/client";
import { collection, query, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, orderBy, Timestamp } from "firebase/firestore";
import { Candidate, CandidateStatus } from "@/lib/types/hr";
import { Dialog } from "@headlessui/react";
import { PlusIcon, XMarkIcon, BriefcaseIcon, UserIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

const COLUMNS: CandidateStatus[] = ["Applied", "Screening", "Interview", "Selected", "Rejected"];

export default function RecruitmentPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCandidate, setNewCandidate] = useState({
    name: "",
    email: "",
    roleApplied: "",
    notes: ""
  });
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "candidates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Candidate));
      setCandidates(data);
    });
    return () => unsub();
  }, []);

  const handleDragStart = (e: React.DragEvent | MouseEvent | TouchEvent | PointerEvent, id: string) => {
    if ('dataTransfer' in e && e.dataTransfer) {
        e.dataTransfer.setData("candidateId", id);
        setDraggedId(id);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDrop = async (e: React.DragEvent, status: CandidateStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("candidateId");
    if (!id || !db) return;
    
    if (draggedId === id) {
        // Optimistic Update
        setCandidates(prev => prev.map(c => c.id === id ? { ...c, status } : c));
        setDraggedId(null);

        await updateDoc(doc(db, "candidates", id), { status });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const addCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
        await addDoc(collection(db, "candidates"), {
        ...newCandidate,
        status: "Applied",
        createdAt: serverTimestamp()
        });
        setIsAddOpen(false);
        setNewCandidate({ name: "", email: "", roleApplied: "", notes: "" });
    } catch (error) {
        console.error("Error adding candidate:", error);
        alert("Failed to add candidate");
    }
  };

  const handleHire = (c: Candidate) => {
    router.push(`/hr/employees?name=${encodeURIComponent(c.name)}&email=${encodeURIComponent(c.email)}`);
  };

  const getStatusColor = (status: CandidateStatus) => {
    switch (status) {
        case "Applied": return "bg-blue-100 text-blue-700";
        case "Screening": return "bg-yellow-100 text-yellow-700";
        case "Interview": return "bg-purple-100 text-purple-700";
        case "Selected": return "bg-green-100 text-green-700";
        case "Rejected": return "bg-red-100 text-red-700";
        default: return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col p-6 overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">Recruitment Pipeline</h1>
            <p className="text-slate-500 text-sm">Manage candidates and hiring process</p>
        </div>
        <button 
          onClick={() => setIsAddOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          Add Candidate
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(status => (
          <div 
            key={status}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, status)}
            className={`flex-shrink-0 w-80 bg-slate-50/80 border border-slate-200 rounded-xl flex flex-col h-full transition-colors ${
                status === 'Selected' ? 'bg-indigo-50/50 border-indigo-100' : ''
            }`}
          >
            <div className="p-4 border-b border-slate-200/50 flex justify-between items-center sticky top-0 bg-inherit rounded-t-xl z-10 backdrop-blur-sm">
               <div className="flex items-center gap-2">
                   <div className={`w-2 h-2 rounded-full ${getStatusColor(status).split(" ")[1].replace("text", "bg")}`}></div>
                   <h3 className="font-semibold text-slate-700">{status}</h3>
               </div>
               <span className="bg-white px-2 py-0.5 rounded-full text-xs font-medium text-slate-500 shadow-sm border border-slate-100">
                 {candidates.filter(c => c.status === status).length}
               </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                <AnimatePresence>
                {candidates
                    .filter(c => c.status === status)
                    .map(c => (
                    <motion.div
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={c.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, c.id)}
                        onDragEnd={handleDragEnd}
                        className={`bg-white p-4 rounded-lg shadow-sm border border-slate-100 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group relative ${
                            draggedId === c.id ? 'opacity-50' : ''
                        }`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-slate-900">{c.name}</h4>
                            {/* <button className="text-slate-400 hover:text-slate-600">
                                <EllipsisHorizontalIcon className="w-5 h-5" />
                            </button> */}
                        </div>
                        
                        <div className="space-y-2 mb-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <BriefcaseIcon className="w-4 h-4" />
                                <span>{c.roleApplied}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <UserIcon className="w-4 h-4" />
                                <span className="truncate">{c.email}</span>
                            </div>
                        </div>

                        {c.notes && (
                            <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 mb-3 line-clamp-2">
                                {c.notes}
                            </p>
                        )}

                        <div className="flex justify-between items-center pt-2 border-t border-slate-50">
                            <span className="text-[10px] text-slate-400">
                                {c.createdAt ? (c.createdAt instanceof Timestamp ? c.createdAt.toDate() : new Date(c.createdAt)).toLocaleDateString() : 'Just now'}
                            </span>
                            
                            {status === "Selected" && (
                                <button 
                                    onClick={() => handleHire(c)}
                                    className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded hover:bg-indigo-700 transition-colors shadow-sm"
                                >
                                    Hire Candidate
                                </button>
                            )}
                        </div>
                    </motion.div>
                ))}
                </AnimatePresence>
                
                {candidates.filter(c => c.status === status).length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm italic">
                        No candidates
                    </div>
                )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={isAddOpen} onClose={() => setIsAddOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-xl w-full">
            <div className="flex justify-between items-center mb-4">
                <Dialog.Title className="text-lg font-bold text-slate-900">Add New Candidate</Dialog.Title>
                <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <XMarkIcon className="w-6 h-6" />
                </button>
            </div>
            
            <form onSubmit={addCandidate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  required
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newCandidate.name}
                  onChange={e => setNewCandidate({ ...newCandidate, name: e.target.value })}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  required
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newCandidate.email}
                  onChange={e => setNewCandidate({ ...newCandidate, email: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role Applied For</label>
                <select
                    required
                    className="w-full border rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    value={newCandidate.roleApplied}
                    onChange={e => setNewCandidate({ ...newCandidate, roleApplied: e.target.value })}
                >
                    <option value="">Select Role...</option>
                    <option value="BDA_TRAINEE">BDA (Trainee)</option>
                    <option value="BDA">Business Development Associate (BDA)</option>
                    <option value="BDM_TRAINING">BDM (Training)</option>
                    <option value="Team Lead">Team Lead</option>
                    <option value="Manager">Manager</option>
                    <option value="HR">HR</option>
                    <option value="Developer">Developer</option>
                    <option value="Designer">Designer</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes / Initial Feedback</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  value={newCandidate.notes}
                  onChange={e => setNewCandidate({ ...newCandidate, notes: e.target.value })}
                  placeholder="Optional notes..."
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
                >
                  Add Candidate
                </button>
              </div>
            </form>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}
