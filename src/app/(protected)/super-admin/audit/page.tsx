"use client";

import { useEffect, useMemo, useState } from 'react';
import { 
  collection, query, orderBy, limit, startAfter, getDocs, where, Timestamp, onSnapshot, DocumentSnapshot 
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AuthGate } from '@/components/auth/AuthGate';
import { 
  ChevronDownIcon, 
  ArrowPathIcon,
  CodeBracketIcon,
  ClockIcon,
  TagIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';

// --- Types ---

type AuditLog = {
  id: string;
  action: string;
  details: string;
  performedBy: string;
  metadata?: Record<string, unknown>;
  timestamp: Timestamp;
};

// --- Components ---

function AuditLogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  
  // Determine severity color for the row border
  const getSeverityClass = (action: string) => {
    const act = action?.toUpperCase() || '';
    if (act.includes('DELETE') || act.includes('FAIL') || act.includes('SECURITY') || act.includes('TERMINATE')) return 'border-l-4 border-l-red-500 bg-red-50/10';
    if (act.includes('EXPORT') || act.includes('VIEW_SENSITIVE') || act.includes('REJECT')) return 'border-l-4 border-l-amber-500 bg-amber-50/10';
    if (act.includes('UPDATE') || act.includes('EDIT') || act.includes('CHANGE')) return 'border-l-4 border-l-blue-500 bg-blue-50/10';
    return 'border-l-4 border-l-emerald-500 bg-emerald-50/10'; // Default / Create / Login
  };

  // Determine badge style
  const getBadgeClass = (action: string) => {
    const act = action?.toUpperCase() || '';
    if (act.includes('DELETE') || act.includes('TERMINATE')) return 'bg-red-50 text-red-700 border-red-100';
    if (act.includes('UPDATE') || act.includes('CHANGE')) return 'bg-blue-50 text-blue-700 border-blue-100';
    if (act.includes('LOGIN')) return 'bg-green-50 text-green-700 border-green-100';
    return 'bg-gray-100 text-gray-800 border-gray-200'; // Default
  };

  const severityClass = getSeverityClass(log.action);
  const badgeClass = getBadgeClass(log.action);

  // Helper to format metadata for display
  const renderMetadataSummary = () => {
    if (log.action === 'LEAD_STATUS_CHANGE' && log.metadata) {
      const { leadId, oldStatus, newStatus, note } = log.metadata as { 
        leadId?: string; 
        oldStatus?: string; 
        newStatus?: string; 
        note?: string; 
      };
      return (
        <div className="text-xs text-gray-600 mt-1 space-y-1">
          <div className="flex gap-2">
            <span className="font-semibold">Lead ID:</span> {leadId}
          </div>
          <div className="flex gap-2 items-center">
            <span className="font-semibold">Status:</span> 
            <span className="bg-gray-100 px-1.5 rounded text-gray-600 line-through">{oldStatus}</span>
            <span>â†’</span>
            <span className="bg-blue-50 px-1.5 rounded text-blue-700 font-medium">{newStatus}</span>
          </div>
          {note && (
            <div className="flex gap-2">
              <span className="font-semibold">Note:</span> {note}
            </div>
          )}
        </div>
      );
    }
    return <div className="text-xs text-gray-500 truncate max-w-md">{log.details}</div>;
  };

  return (
    <>
      <tr 
        onClick={() => setExpanded(!expanded)} 
        className={`hover:bg-gray-50 cursor-pointer transition-all duration-200 group ${expanded ? 'bg-gray-50' : ''}`}
      >
        <td className={`px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-500 ${severityClass}`}>
          {log.timestamp?.toDate ? format(log.timestamp.toDate(), 'MMM d, HH:mm:ss') : 'Pending...'}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="flex items-center">
            <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-[10px] font-bold mr-2 ring-2 ring-white">
              {(log.performedBy || '?')[0].toUpperCase()}
            </div>
            <span className="text-sm font-medium text-gray-900">{log.performedBy}</span>
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium font-mono border ${badgeClass}`}>
            {log.action}
          </span>
        </td>
        <td className="px-6 py-4">
           {renderMetadataSummary()}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium">
          <button className="text-indigo-600 hover:text-indigo-900 flex items-center justify-end gap-1 ml-auto">
            <CodeBracketIcon className="h-4 w-4" />
            {expanded ? 'Hide Payload' : 'View Payload'}
          </button>
        </td>
      </tr>
      
      {/* EXPANDED VIEW */}
      {expanded && (
        <tr className="bg-gray-50 shadow-inner">
          <td colSpan={5} className="px-6 py-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 font-mono text-xs text-gray-600 overflow-x-auto">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-1">
                  <strong className="block text-gray-900 mb-2 flex items-center gap-2">
                    <CodeBracketIcon className="h-4 w-4 text-gray-500" />
                    Metadata / Payload
                  </strong>
                  <div className="bg-slate-50 rounded border border-slate-100 p-3">
                     <pre className="whitespace-pre-wrap break-all">{JSON.stringify(log.metadata, null, 2)}</pre>
                  </div>
                </div>
                <div className="w-full md:w-1/3 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-8">
                  <strong className="block text-gray-900 mb-3 uppercase tracking-wider text-[10px]">Technical Context</strong>
                  <dl className="space-y-3">
                    <div>
                        <dt className="text-gray-400 text-[10px] uppercase">Details</dt>
                        <dd className="text-gray-900 font-medium">{log.details || 'N/A'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400 text-[10px] uppercase">Log ID</dt>
                        <dd className="text-gray-500">{log.id}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function BlackBoxAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [filterType, setFilterType] = useState('ALL');
  const [dateRange, setDateRange] = useState('ALL'); // '24H', '7D', 'ALL'
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isRealTime, setIsRealTime] = useState(true);

  // 1. REAL-TIME LISTENER FOR INITIAL VIEW
  useEffect(() => {
    if (!db) return;
    
    // Only use real-time listener if we are on the first "page" (no manual pagination yet) and standard filters
    // If user starts paginating, we might switch to static fetching to avoid jumping content
    
    setLoading(true);

    let q = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    // Apply Filters
    if (filterType !== 'ALL') {
      q = query(q, where('action', '==', filterType));
    }
    
    // Date Range Filter
    const now = new Date();
    if (dateRange === '24H') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      q = query(q, where('timestamp', '>=', Timestamp.fromDate(yesterday)));
    } else if (dateRange === '7D') {
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      q = query(q, where('timestamp', '>=', Timestamp.fromDate(lastWeek)));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
      setLogs(newLogs);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setLoading(false);
      setIsRealTime(true);
      
      // If we got fewer than 50 docs, no more to load
      setHasMore(snapshot.docs.length === 50);
    }, (error) => {
      console.error("Real-time audit fetch failed:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [filterType, dateRange]);

  // 2. PAGINATION (Static Fetch)
  const loadMore = async () => {
    if (loading || !db || !lastDoc) return;
    setLoading(true);
    
    try {
      let q = query(
        collection(db, 'audit_logs'),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(50)
      );

      // Apply Filters (Must match the listener filters)
      if (filterType !== 'ALL') {
        q = query(q, where('action', '==', filterType));
      }
      
      if (dateRange === '24H') {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        q = query(q, where('timestamp', '>=', Timestamp.fromDate(yesterday)));
      } else if (dateRange === '7D') {
        const now = new Date();
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        q = query(q, where('timestamp', '>=', Timestamp.fromDate(lastWeek)));
      }

      const snapshot = await getDocs(q);
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));

      if (newLogs.length < 50) {
        setHasMore(false);
      }

      setLogs(prev => [...prev, ...newLogs]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setIsRealTime(false); // Once we load more, we are likely mixing static and dynamic, or just appending.
                            // Technically the top 50 are still live if we didn't detach, but usually we just append.
                            // The listener above will KEEP updating the top 50. The appended ones are static.
      
    } catch (error) {
      console.error("Audit fetch failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return logs;

    return logs.filter((log) => {
      const payload = log.metadata ? JSON.stringify(log.metadata).toLowerCase() : '';
      return (
        (log.action || '').toLowerCase().includes(normalized) ||
        (log.details || '').toLowerCase().includes(normalized) ||
        (log.performedBy || '').toLowerCase().includes(normalized) ||
        (log.id || '').toLowerCase().includes(normalized) ||
        payload.includes(normalized)
      );
    });
  }, [logs, searchTerm]);

  return (
    <AuthGate allowedOrgRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-gray-50/50 p-6 space-y-6">
        
        {/* HEADER & FILTERS */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full ${isRealTime ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Audit Logs</h1>
            </div>
            <p className="text-sm text-gray-500 font-mono">
              {isRealTime ? 'Live Monitoring Active' : 'Historical Data Loaded'} â€¢ {filteredLogs.length} / {logs.length} Records
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search action, actor, details, payload"
              className="w-full min-w-[260px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 md:w-auto"
            />
             {/* Action Type Filter */}
             <div className="relative">
               <select 
                 value={filterType}
                 onChange={(e) => {
                   setFilterType(e.target.value);
                   setLogs([]); // Clear logs on filter change to avoid confusion before snapshot updates
                 }}
                 className="appearance-none pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer hover:bg-gray-50 transition-colors"
               >
                 <option value="ALL">All Actions</option>
                 <option value="LOGIN">Logins</option>
                 <option value="LEAD_STATUS_CHANGE">Lead Status Changes</option>
                 <option value="ASSIGN_LEAD">Lead Assignments</option>
                 <option value="CREATE_USER">User Creation</option>
                 <option value="SYSTEM_CHANGE">System Config</option>
               </select>
               <TagIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
               <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
             </div>

             {/* Date Range Filter */}
             <div className="relative">
               <select 
                 value={dateRange}
                 onChange={(e) => setDateRange(e.target.value)}
                 className="appearance-none pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer hover:bg-gray-50 transition-colors"
               >
                 <option value="ALL">All Time</option>
                 <option value="24H">Last 24 Hours</option>
                 <option value="7D">Last 7 Days</option>
               </select>
               <ClockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
               <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
             </div>
          </div>
        </div>
  
        {/* THE LOG TABLE */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ring-1 ring-black/5">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50/50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Timestamp</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actor</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Details / Context</th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredLogs.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                      <div className="flex flex-col items-center justify-center">
                        <CodeBracketIcon className="h-12 w-12 text-gray-200 mb-3" />
                        <p className="text-sm font-medium">No audit logs found.</p>
                        <p className="text-xs mt-1">Try adjusting your filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <AuditLogRow key={log.id} log={log} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* LOAD MORE TRIGGER */}
          {hasMore && (
            <div className="p-4 border-t border-gray-100 bg-gray-50/30 text-center">
               <button 
                 onClick={loadMore} 
                 disabled={loading} 
                 className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {loading ? (
                   <>
                     <ArrowPathIcon className="h-4 w-4 animate-spin" />
                     Loading...
                   </>
                 ) : (
                   'Load older records'
                 )}
               </button> 
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}

