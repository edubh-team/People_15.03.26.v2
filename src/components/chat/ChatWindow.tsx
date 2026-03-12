import React, { useState, useEffect, useRef } from 'react';
import { useEnvelopeChat } from '@/lib/hooks/useEnvelopeChat';
import { MessageBubble } from './MessageBubble';
import { SecuritySettingsModal } from './SecuritySettingsModal';
import { PaperAirplaneIcon, PaperClipIcon, LockClosedIcon } from '@heroicons/react/24/solid';

interface ChatWindowProps {
  channelId: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ channelId }) => {
  const { messages, loading, sendMessage, deleteMessageGlobal, deleteMessageLocal, undoDeleteMessageLocal } = useEnvelopeChat(channelId);
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showUndoToast, setShowUndoToast] = useState<{msgId: string, visible: boolean}>({ msgId: '', visible: false });
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    
    const text = inputText;
    setSendError(null);
    setInputText(''); // Optimistic clear
    try {
      await sendMessage(text);
    } catch (error) {
      setInputText(text);
      setSendError(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
    }
  };

  const handleDeleteLocal = async (msgId: string) => {
      await deleteMessageLocal(msgId);
      setShowUndoToast({ msgId, visible: true });
      setTimeout(() => setShowUndoToast(prev => prev.msgId === msgId ? { ...prev, visible: false } : prev), 5000);
  };

  const handleUndo = async () => {
      if (showUndoToast.msgId) {
          await undoDeleteMessageLocal(showUndoToast.msgId);
          setShowUndoToast({ msgId: '', visible: false });
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading && messages.length === 0) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center h-full bg-white/30 backdrop-blur-md">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
                <LockClosedIcon className="w-3 h-3" /> Unlocking secure messages...
            </p>
        </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white/30 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl overflow-hidden relative">
      {/* Header Info (Security Indicator) */}
      <div className="absolute top-2 right-4 z-10 opacity-50 hover:opacity-100 transition-opacity">
        <button 
            onClick={() => setIsSecurityModalOpen(true)}
            className="flex items-center gap-1 text-[10px] text-gray-500 bg-white/50 px-2 py-1 rounded-full border border-gray-100 hover:bg-white cursor-pointer transition-colors"
        >
            <LockClosedIcon className="w-3 h-3 text-green-600" />
            <span>End-to-End Encrypted</span>
        </button>
      </div>

      <SecuritySettingsModal 
        isOpen={isSecurityModalOpen} 
        onClose={() => setIsSecurityModalOpen(false)} 
      />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2 scrollbar-thin scrollbar-thumb-gray-200 pt-8">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="text-sm">No messages here yet.</p>
            <p className="text-xs">Say hello securely!</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isFirst = index === 0;
            const isDifferentSender = isFirst || messages[index - 1].senderId !== msg.senderId;
            return (
              <MessageBubble 
                  key={msg.id} 
                  message={msg} 
                  showSenderName={isDifferentSender}
                  onDeleteGlobal={() => deleteMessageGlobal(msg.id)}
                  onDeleteLocal={() => handleDeleteLocal(msg.id)}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Undo Toast */}
      {showUndoToast.visible && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
              <div className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-4 text-sm">
                  <span>Message deleted for you</span>
                  <button 
                      onClick={handleUndo}
                      className="text-blue-400 font-semibold hover:text-blue-300 transition-colors"
                  >
                      UNDO
                  </button>
              </div>
          </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-white/60 border-t border-gray-100 backdrop-blur-xl">
        {sendError ? (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {sendError}
          </div>
        ) : null}
        <form onSubmit={handleSend} className="flex items-center gap-2 relative">
           <button
            type="button"
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100"
            title="Attach file (Coming Soon)"
           >
             <PaperClipIcon className="w-5 h-5" />
           </button>
           
           <input
             type="text"
             value={inputText}
             onChange={(e) => setInputText(e.target.value)}
             onKeyDown={handleKeyDown}
             placeholder="Type a message..."
             className="flex-1 bg-gray-100/50 border border-gray-200 text-gray-800 text-sm rounded-full px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
           />
           
           <button
             type="submit"
             disabled={!inputText.trim()}
             className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg transform active:scale-95"
           >
             <PaperAirplaneIcon className="w-5 h-5" />
           </button>
        </form>
      </div>
    </div>
  );
};
