"use client";

import React, { useState } from 'react';
import { useSignalChannels } from '@/lib/hooks/useSignalChat';
import { ChannelList } from '@/components/chat/ChannelList';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { PlusIcon, XMarkIcon, Bars3Icon, UserGroupIcon, LockClosedIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAuth } from '@/components/auth/AuthProvider';
import { CreateGroupModal } from '@/components/chat/CreateGroupModal';
import { useKeyInitialization } from '@/lib/hooks/useKeyInitialization';

export default function ChatPage() {
  const { channels, loading, createSignalGroup, createSignalDM, deleteChannel, deleteAllChannels } = useSignalChannels();
  const { isReady } = useKeyInitialization();
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  
  if (!isReady) {
    return (
        <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-gray-50">
            <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p className="text-gray-500 text-sm font-medium flex items-center gap-2">
                    <LockClosedIcon className="w-4 h-4" />
                    Setting up secure encryption...
                </p>
            </div>
        </div>
    );
  }

  const handleSelectChannel = (id: string) => {
    setSelectedChannelId(id);
    setIsMobileMenuOpen(false);
  };

  const handleCreateGroup = async (name: string, uids: string[]) => {
    const channelId = await createSignalGroup(name, uids);
    if (channelId) {
      handleSelectChannel(channelId);
      setIsCreateGroupModalOpen(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50/50 relative">
      {/* Mobile Menu Toggle */}
      <button 
        className="md:hidden absolute top-4 left-4 z-[49] p-2 bg-white rounded-md shadow-sm border border-gray-200"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen ? <XMarkIcon className="w-5 h-5" /> : <Bars3Icon className="w-5 h-5" />}
      </button>

      {/* Sidebar (Channel List) */}
      <aside 
        className={`
          absolute inset-y-0 left-0 z-40 w-80 bg-white/80 backdrop-blur-xl border-r border-gray-200 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white/50">
            <h2 className="font-semibold text-lg text-gray-800">Messages</h2>
            <div className="flex gap-1">
              <button 
                onClick={deleteAllChannels}
                className="p-2 rounded-full hover:bg-red-50 text-red-400 hover:text-red-500 transition-colors"
                title="Remove all from inbox"
              >
                <TrashIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsCreateGroupModalOpen(true)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                title="New Group"
              >
                <UserGroupIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsNewChatModalOpen(true)}
                className="p-2 rounded-full hover:bg-gray-100 text-blue-600 transition-colors"
                title="New Message"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <ChannelList 
              channels={channels} 
              selectedId={selectedChannelId} 
              onSelect={handleSelectChannel} 
              onDelete={deleteChannel}
              loading={loading}
            />
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative w-full">
        {selectedChannelId ? (
          <ChatWindow channelId={selectedChannelId} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-white/30 backdrop-blur-sm">
             <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-gray-300">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
             </div>
             <p className="text-lg font-medium text-gray-500">Select a conversation</p>
          </div>
        )}
      </main>
      
      {/* New Chat Modal */}
      {isNewChatModalOpen && (
        <NewChatModal 
          onClose={() => setIsNewChatModalOpen(false)} 
          onCreate={async (uid) => {
            try {
                const id = await createSignalDM(uid);
                if (id) {
                    handleSelectChannel(id);
                    setIsNewChatModalOpen(false);
                }
            } catch (e) {
                console.error(e);
                alert("Failed to start secure chat. User may not have keys setup.");
            }
          }} 
        />
      )}

      {/* Create Group Modal */}
      <CreateGroupModal 
        isOpen={isCreateGroupModalOpen}
        onClose={() => setIsCreateGroupModalOpen(false)}
        onCreate={handleCreateGroup}
      />
    </div>
  );
}

// Simple User Picker Modal
function NewChatModal({ onClose, onCreate }: { onClose: () => void, onCreate: (uid: string) => void }) {
    const { data: users, isLoading } = useUsers({
      maxResults: 2500,
      onlyActive: true,
      sortByName: true,
    });
    const { firebaseUser } = useAuth();
    const [search, setSearch] = useState("");

    const normalizedSearch = search.trim().toLowerCase();
    const filteredUsers = users?.filter(u => 
        u.uid !== firebaseUser?.uid && 
        (!normalizedSearch ||
          (u.displayName || "").toLowerCase().includes(normalizedSearch) ||
          (u.email || "").toLowerCase().includes(normalizedSearch) ||
          (u.employeeId || "").toLowerCase().includes(normalizedSearch) ||
          `${u.orgRole ?? ""} ${u.role ?? ""}`.toLowerCase().includes(normalizedSearch))
    ) || [];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-semibold text-lg">New Message</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
                        <XMarkIcon className="w-5 h-5 text-gray-500" />
                    </button>
                </div>
                <div className="p-4 border-b border-gray-100">
                    <input 
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-500"
                        placeholder="Search people..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {isLoading ? (
                        <div className="p-4 text-center text-gray-500">Loading users...</div>
                    ) : (
                        <div className="space-y-1">
                            {filteredUsers.map(u => (
                                <button 
                                    key={u.uid}
                                    onClick={() => onCreate(u.uid)}
                                    className="w-full flex items-center p-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold mr-3 text-sm">
                                        {u.displayName?.[0] || u.email?.[0] || "?"}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900">{u.displayName || "Unknown"}</div>
                                        <div className="text-xs text-gray-500">
                                          {u.orgRole ?? u.role}
                                          {u.email ? ` | ${u.email}` : ""}
                                        </div>
                                    </div>
                                </button>
                            ))}
                            {filteredUsers.length === 0 && (
                                <div className="p-4 text-center text-gray-500 text-sm">No users found.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
