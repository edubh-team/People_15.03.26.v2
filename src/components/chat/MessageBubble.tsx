import React from 'react';
import { MessageDoc } from '@/lib/hooks/useChat';
import { SignalMessageDoc } from '@/lib/hooks/useSignalChat';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { EllipsisHorizontalIcon, TrashIcon, EyeSlashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { DecryptedMessage } from './DecryptedMessage';
import { DecryptedImage } from './DecryptedImage';
import UserNameDisplay from '@/components/common/UserNameDisplay';

interface MessageBubbleProps {
  message: SignalMessageDoc | MessageDoc;
  onDeleteGlobal?: () => void;
  onDeleteLocal?: () => void;
  showSenderName?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onDeleteGlobal, onDeleteLocal, showSenderName }) => {
  const { firebaseUser } = useAuth();
  const isMe = firebaseUser?.uid === message.senderId;
  const isDeleted = message.isDeleted;
  const isDecrypted = (message as SignalMessageDoc).isDecrypted;
  const isError = (message as SignalMessageDoc).decryptionError;

  // Check if message is < 15 mins old for "Delete for Everyone"
  const canDeleteGlobal = isMe && message.createdAt && (new Date().getTime() - message.createdAt.toDate().getTime() < 15 * 60 * 1000);

  if (isDeleted) {
      return (
        <div className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] md:max-w-[70%] px-4 py-2 rounded-2xl text-sm italic text-gray-500 bg-gray-100 border border-gray-200 ${isMe ? 'rounded-br-none' : 'rounded-bl-none'}`}>
                This message was deleted.
            </div>
        </div>
      );
  }

  return (
    <div className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} group transition-all duration-300 ease-out`}>
      <div className="relative max-w-[85%] md:max-w-[70%]">
        {showSenderName && !isMe && (
          <div className="mb-1 ml-1 text-xs text-slate-500 font-medium">
            <UserNameDisplay uid={message.senderId} />
          </div>
        )}
        {/* Context Menu (Hover) */}
        <div className={`absolute top-1/2 -translate-y-1/2 ${isMe ? 'right-full mr-2' : 'left-full ml-2'} opacity-0 group-hover:opacity-100 transition-opacity z-20`}>
           <Menu as="div" className="relative inline-block text-left">
              <MenuButton className="p-1 rounded-full hover:bg-gray-100 bg-white/50 backdrop-blur-sm border border-gray-200 shadow-sm">
                  <EllipsisHorizontalIcon className="w-4 h-4 text-gray-500" />
              </MenuButton>
              <MenuItems className={`absolute mt-1 w-36 divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 ${isMe ? 'origin-top-right right-0' : 'origin-top-left left-0'}`}>
                  <div className="px-1 py-1">
                      {canDeleteGlobal && onDeleteGlobal && (
                          <MenuItem>
                              {({ active }) => (
                                  <button
                                      onClick={onDeleteGlobal}
                                      className={`${active ? 'bg-red-50 text-red-700' : 'text-gray-900'} group flex w-full items-center rounded-md px-2 py-2 text-xs`}
                                  >
                                      <TrashIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Delete for everyone
                                  </button>
                              )}
                          </MenuItem>
                      )}
                      {onDeleteLocal && (
                          <MenuItem>
                              {({ active }) => (
                                  <button
                                      onClick={onDeleteLocal}
                                      className={`${active ? 'bg-blue-50 text-blue-700' : 'text-gray-900'} group flex w-full items-center rounded-md px-2 py-2 text-xs`}
                                  >
                                      <EyeSlashIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Delete for me
                                  </button>
                              )}
                          </MenuItem>
                      )}
                  </div>
              </MenuItems>
           </Menu>
        </div>

        <div
          className={`px-4 py-2 rounded-2xl text-sm shadow-sm relative ${
            isMe
              ? 'bg-blue-500 text-white rounded-br-none'
              : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'
          } ${isError ? 'bg-red-50 border-red-200 text-red-600' : ''}`}
        >
          {message.type === 'image' ? (
             isDecrypted ? (
                 <img 
                    src={message.content} 
                    alt="Shared image" 
                    className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity mt-1 border border-black/10" 
                    onClick={() => window.open(message.content, '_blank')}
                 />
             ) : isError ? (
                 <div className="flex items-center gap-2 italic text-xs text-red-500">
                     <ExclamationTriangleIcon className="w-4 h-4" /> Decryption Failed
                 </div>
             ) : (
                 <DecryptedImage
                    ciphertext={message.content}
                    senderId={message.senderId}
                    type={(message as SignalMessageDoc).signalMessageType}
                 />
             )
          ) : (
            <div className="break-words">
                {isDecrypted || isError ? message.content : (
                    <DecryptedMessage 
                        ciphertext={message.content}
                        senderId={message.senderId}
                        type={(message as SignalMessageDoc).signalMessageType}
                    />
                )}
            </div>
          )}
          <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
            {message.createdAt ? format(message.createdAt.toDate(), 'h:mm a') : '...'}
          </div>
        </div>
      </div>
    </div>
  );
};
