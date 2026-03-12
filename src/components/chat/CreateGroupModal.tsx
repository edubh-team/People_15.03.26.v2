
"use client";

import { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { useUsers } from "@/lib/hooks/useUsers";
import { UserDoc } from "@/lib/types/user";
import { useAuth } from "@/components/auth/AuthProvider";

export function CreateGroupModal({ 
  isOpen, 
  onClose, 
  onCreate 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onCreate: (name: string, uids: string[]) => Promise<void>;
}) {
  const { firebaseUser } = useAuth();
  const { data: users = [] } = useUsers({
    maxResults: 2500,
    onlyActive: true,
    sortByName: true,
  });
  const [groupName, setGroupName] = useState("");
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (u.uid === firebaseUser?.uid) return false;
    if (!normalizedSearch) return true;
    const roleLabel = `${u.orgRole ?? ""} ${u.role ?? ""}`.toLowerCase();
    return (
      (u.displayName || "").toLowerCase().includes(normalizedSearch) ||
      (u.email || "").toLowerCase().includes(normalizedSearch) ||
      (u.employeeId || "").toLowerCase().includes(normalizedSearch) ||
      roleLabel.includes(normalizedSearch)
    );
  });

  const toggleUser = (uid: string) => {
    if (selectedUids.includes(uid)) {
      setSelectedUids(selectedUids.filter(id => id !== uid));
    } else {
      setSelectedUids([...selectedUids, uid]);
    }
  };

  const handleSubmit = async () => {
    if (!groupName || selectedUids.length === 0) return;
    setIsSubmitting(true);
    try {
      await onCreate(groupName, selectedUids);
      onClose();
      setGroupName("");
      setSelectedUids([]);
    } catch (e) {
      console.error(e);
      alert("Failed to create group. Ensure all members have identity keys.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-gray-100">
          <DialogTitle className="text-lg font-semibold text-gray-900 mb-4">
            New Group
          </DialogTitle>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
              <input
                type="text"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 text-sm placeholder-gray-500 p-1"
                placeholder="Project Alpha"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Add Members</label>
              <input 
                type="text"
                placeholder="Search people..."
                className="w-full mb-2 text-sm rounded-md border-gray-200 text-gray-900 placeholder-gray-500 p-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                {filteredUsers.map((user: UserDoc) => (
                  <div 
                    key={user.uid} 
                    className={`flex items-center p-2 cursor-pointer hover:bg-gray-50 ${selectedUids.includes(user.uid) ? 'bg-blue-50' : ''}`}
                    onClick={() => toggleUser(user.uid)}
                  >
                    <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 mr-3">
                        {user.displayName?.[0] || "?"}
                    </div>
                    <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{user.displayName}</div>
                        <div className="text-xs text-gray-500">
                          {user.orgRole ?? user.role}
                          {user.email ? ` | ${user.email}` : ""}
                        </div>
                    </div>
                    {selectedUids.includes(user.uid) && (
                        <div className="text-blue-600">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">{selectedUids.length} members selected</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button 
                onClick={handleSubmit}
                disabled={!groupName || selectedUids.length === 0 || isSubmitting}
                className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
