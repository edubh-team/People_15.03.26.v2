import React from 'react';
import { ChannelDoc } from '@/lib/hooks/useChat';
import { format } from 'date-fns';
import { UserGroupIcon, UserIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAuth } from '@/components/auth/AuthProvider';

interface ChannelListProps {
  channels: ChannelDoc[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  loading: boolean;
}

export const ChannelList: React.FC<ChannelListProps> = ({ channels, selectedId, onSelect, onDelete, loading }) => {
  const { data: users = [] } = useUsers();
  const { firebaseUser } = useAuth();

  const getChannelName = (channel: ChannelDoc) => {
    if (channel.name) return channel.name;
    
    if (channel.type === 'DM') {
      const otherUid = channel.participants.find(uid => uid !== firebaseUser?.uid);
      // If no other participant (self chat), use own uid
      const targetUid = otherUid || firebaseUser?.uid;
      
      if (targetUid) {
        const user = users.find(u => u.uid === targetUid);
        return user?.displayName || user?.email || 'Unknown User';
      }
      return 'Direct Message';
    }
    
    return 'Channel';
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-500 text-sm">Loading channels...</div>;
  }

  if (channels.length === 0) {
    return <div className="p-4 text-center text-gray-500 text-sm">No conversations yet.</div>;
  }

  return (
    <div className="flex flex-col space-y-1 p-2">
      {channels.map((channel) => {
        const isSelected = selectedId === channel.id;
        const channelName = getChannelName(channel);
        
        return (
          <button
            key={channel.id}
            onClick={() => onSelect(channel.id)}
            className={`w-full flex items-center p-3 rounded-xl transition-all duration-200 text-left group ${
              isSelected 
                ? 'bg-blue-500/10 text-blue-900 shadow-sm border border-blue-100' 
                : 'hover:bg-white/50 hover:shadow-sm border border-transparent'
            }`}
          >
            <div className={`p-2 rounded-full mr-3 ${isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
              {channel.type === 'TEAM' || channel.type === 'GROUP' || channel.type === 'BROADCAST' ? (
                <UserGroupIcon className="w-5 h-5" />
              ) : (
                <UserIcon className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <h3 className={`text-sm font-semibold truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                  {channelName}
                </h3>
                {channel.lastMessage?.timestamp && (
                  <span className="text-[10px] text-gray-400">
                    {format(channel.lastMessage.timestamp.toDate(), 'h:mm a')}
                  </span>
                )}
              </div>
              <p className={`text-xs truncate ${isSelected ? 'text-blue-700/80' : 'text-gray-500'}`}>
                 {channel.lastMessage?.senderId === 'SYSTEM' ? '' : 
                  (channel.lastMessage?.senderId ? `${channel.lastMessage.text}` : 'No messages yet')}
              </p>
            </div>
            
            {/* Delete Option (Visible on Group Hover or if Selected) */}
            {onDelete && (
                <div className={`ml-2 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-100' : ''}`}>
                    <div 
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(channel.id);
                        }}
                        className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove from inbox"
                    >
                        <TrashIcon className="w-4 h-4" />
                    </div>
                </div>
            )}
          </button>
        );
      })}
    </div>
  );
};
