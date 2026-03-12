import { useState, useEffect } from 'react';
import { useAuth } from "@/components/auth/AuthProvider";
import { 
  collection, query, where, getDocs, orderBy, limit, startAfter, Timestamp, DocumentSnapshot 
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { MagnifyingGlassIcon, ClipboardDocumentIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { LeadDoc } from '@/lib/types/crm';
import UserNameDisplay from "@/components/common/UserNameDisplay";

import { isRevenueLead } from "@/lib/utils/leadLogic";
import { format } from 'date-fns';
import { toTitleCase } from '@/lib/utils/stringUtils';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/client';
import { WrenchIcon } from '@heroicons/react/24/outline';
import Select from '@/components/ui/Select';
import SearchableCombobox from '@/components/ui/Combobox';

import { UserDoc } from '@/lib/types/user';
import { canUseCrmInspector, canUseGlobalCrmView, leadMatchesCrmScope } from '@/lib/crm/access';
import { searchCrmLeads } from '@/lib/crm/search';

function chunkUids(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export default function LeadInspector({
  onViewDetails,
  allowedOwnerUids = null,
}: {
  onViewDetails: (lead: LeadDoc) => void;
  allowedOwnerUids?: string[] | null;
}) {
  const { userDoc } = useAuth();
  const isGlobalCrmView = canUseGlobalCrmView(userDoc);
  
  const ITEMS_PER_PAGE = 100;
  const REVENUE_SCAN_LIMIT = 500;
  const [searchTerm, setSearchTerm] = useState('');
  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Filters
  const [viewMode, setViewMode] = useState<'all' | 'revenue'>('all'); // 'all' or 'revenue'
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortOption, setSortOption] = useState('created_desc'); // 'created_desc', 'created_asc', 'updated_desc', 'updated_asc'
  const [users, setUsers] = useState<{uid: string, name: string}[]>([]);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<{ [page: number]: DocumentSnapshot | null }>({ 1: null });
  const [hasMore, setHasMore] = useState(true); // Optimistic initially

  // Fetch Users for Dropdown
  useEffect(() => {
    if (!db) return;
    const firestore = db;
    const fetchUsers = async () => {
      try {
        const q = query(collection(firestore, 'users'), where('status', '==', 'active'));
        const snap = await getDocs(q);
        const userList = snap.docs.map(d => {
          const data = d.data() as UserDoc;
          return { uid: d.id, name: data.name || data.displayName || 'Unknown' };
        }).sort((a, b) => a.name.localeCompare(b.name));
        setUsers(userList);
      } catch (e) {
        console.error("Failed to fetch users", e);
      }
    };
    fetchUsers();
  }, []);

  // Derived Filtered & Sorted Leads
  const filteredLeads = leads.filter(lead => {
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    const matchesAssignee = assigneeFilter === 'all' 
      ? true 
      : assigneeFilter === 'unassigned' 
        ? !lead.assignedTo 
        : lead.assignedTo === assigneeFilter;
    return matchesStatus && matchesAssignee;
  });

  const getTimestamp = (val: unknown): number => {
    if (!val) return 0;
    if (val instanceof Timestamp) return val.toMillis();
    if (typeof val === 'string') return new Date(val).getTime();
    if (val instanceof Date) return val.getTime();
    return 0;
  };

  const sortedLeads = [...filteredLeads].sort((a, b) => {
    let valA = 0;
    let valB = 0;

    switch (sortOption) {
      case 'created_desc':
      case 'created_asc':
        valA = getTimestamp(a.createdAt);
        valB = getTimestamp(b.createdAt);
        break;
      case 'updated_desc':
      case 'updated_asc':
        // Use updatedAt, fallback to createdAt if missing
        valA = getTimestamp(a.updatedAt) || getTimestamp(a.createdAt);
        valB = getTimestamp(b.updatedAt) || getTimestamp(b.createdAt);
        break;
      default:
        return 0;
    }

    if (sortOption.endsWith('_desc')) {
      return valB - valA;
    } else {
      return valA - valB;
    }
  });

  // 1. INITIAL FETCH (Show recent leads)
  useEffect(() => {
    if (canUseCrmInspector(userDoc)) {
      fetchRecentLeads(1, null);
    }
  }, [userDoc, viewMode, allowedOwnerUids]);

  const fetchRecentLeads = async (page: number, cursor: DocumentSnapshot | null) => {
    setLoading(true);
    setSearchError(''); // Clear errors when fetching regular list
    try {
      if (!db) return;
      const firestore = db;

      if (!isGlobalCrmView && allowedOwnerUids && allowedOwnerUids.length > 0) {
        const chunks = chunkUids(allowedOwnerUids, 10);
        const scopedSnapshots = await Promise.all(
          chunks.flatMap((chunk) => [
            getDocs(query(collection(firestore, 'leads'), where('assignedTo', 'in', chunk), orderBy('updatedAt', 'desc'), limit(ITEMS_PER_PAGE))),
            getDocs(query(collection(firestore, 'leads'), where('ownerUid', 'in', chunk), orderBy('updatedAt', 'desc'), limit(ITEMS_PER_PAGE))),
            getDocs(query(collection(firestore, 'leads'), where('closedBy.uid', 'in', chunk), orderBy('updatedAt', 'desc'), limit(ITEMS_PER_PAGE))),
          ]),
        );

        const scopedMap = new Map<string, LeadDoc>();
        scopedSnapshots.forEach((snapshot) => {
          snapshot.docs.forEach((leadDoc) => {
            const lead = { ...leadDoc.data(), leadId: leadDoc.id } as unknown as LeadDoc;
            if (leadMatchesCrmScope(lead, allowedOwnerUids)) {
              scopedMap.set(leadDoc.id, lead);
            }
          });
        });

        let scopedLeads = Array.from(scopedMap.values()).sort((left, right) => {
          const leftTime = getTimestamp(left.updatedAt) || getTimestamp(left.createdAt);
          const rightTime = getTimestamp(right.updatedAt) || getTimestamp(right.createdAt);
          return rightTime - leftTime;
        });

        if (viewMode === 'revenue') {
          scopedLeads = scopedLeads.filter((lead) => isRevenueLead(lead));
        }

        setLeads(scopedLeads);
        setHasMore(false);
        setCurrentPage(1);
        setPageCursors({ 1: null });
        return;
      }
      
      let q;

      if (viewMode === 'revenue') {
         // Revenue mode stays recent-window scoped to avoid scanning the entire collection.
         q = query(
             collection(firestore, 'leads'), 
             orderBy('updatedAt', 'desc'),
             limit(REVENUE_SCAN_LIMIT),
          );
       } else {
          // STANDARD MODE: Fetch all recent
          q = query(
             collection(firestore, 'leads'), 
             orderBy('createdAt', 'desc'), 
             limit(ITEMS_PER_PAGE)
          );
       }

      if (cursor && viewMode !== 'revenue') {
        q = query(q, startAfter(cursor));
      }

      const snapshot = await getDocs(q);

      let newLeads = snapshot.docs.map(d => {
        const data = d.data();
        return { ...data, leadId: d.id } as unknown as LeadDoc;
      });

      if (allowedOwnerUids) {
        newLeads = newLeads.filter((lead) => leadMatchesCrmScope(lead, allowedOwnerUids));
      }

      // Client-side filtering for Revenue Mode to match Dashboard Logic exactly
      if (viewMode === 'revenue') {
          newLeads = newLeads.filter(lead => isRevenueLead(lead));
          
          setLeads(newLeads);
          // Disable server-side pagination for revenue view since we fetch all relevant docs
          setHasMore(false); 
          setCurrentPage(1);
          setPageCursors({ 1: null });
      } else {
          setLeads(newLeads);
          setHasMore(snapshot.docs.length === ITEMS_PER_PAGE); 
          setCurrentPage(page);

          // Store the cursor for the NEXT page (which is the last doc of this page)
          if (snapshot.docs.length > 0) {
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];
            setPageCursors(prev => ({
              ...prev,
              [page + 1]: lastDoc
            }));
          }
      }

    } catch (err) {
      console.error(err);
      setSearchError('Failed to load leads.');
    } finally {
      setLoading(false);
    }
  };

  const handleNextPage = () => {
    const nextPage = currentPage + 1;
    const cursor = pageCursors[nextPage];
    // If we have a cursor for the next page, use it
    if (cursor) {
      fetchRecentLeads(nextPage, cursor);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prevPage = currentPage - 1;
      const cursor = pageCursors[prevPage]; // Should exist if we visited it
      fetchRecentLeads(prevPage, cursor);
    }
  };

  const handleFixLeads = async () => {
    if (!functions || !userDoc) return;
    
    if (!confirm("This will scan ALL leads to ensure Title Case names and generate 'LD-' IDs for any missing them. This may take a while. Continue?")) {
        return;
    }

    setMaintenanceLoading(true);
    try {
        const manualLeadMaintenance = httpsCallable(functions, 'manualLeadMaintenance');
        const result = await manualLeadMaintenance();
        const data = result.data as { success: boolean; message: string };
        alert(data.message || "Maintenance completed successfully.");
        // Refresh leads to show updates
        fetchRecentLeads(1, null);
    } catch (error) {
        console.error("Maintenance failed:", error);
        alert("Failed to run maintenance: " + (error instanceof Error ? error.message : String(error)));
    } finally {
        setMaintenanceLoading(false);
    }
  };


  // 2. SMART SEARCH LOGIC
  
  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) {
      // Reset to page 1
      setPageCursors({ 1: null });
      fetchRecentLeads(1, null);
      return;
    }

    setLoading(true);
    setSearchError('');
    setLeads([]);

    try {
      if (!db) throw new Error("Database not initialized");
      const firestore = db;
      const orderedResults = await searchCrmLeads({
        firestore,
        term: searchTerm,
        allowedOwnerUids,
        limitPerQuery: 10,
        maxResults: 30,
      });

      if (orderedResults.length === 0) {
        setSearchError('No lead found matching your criteria.');
      }
      
      setLeads(orderedResults);
      // Disable pagination for search results
      setHasMore(false); 
      setCurrentPage(1);

    } catch (error) {
      console.error("Search failed:", error);
      setSearchError('An error occurred during search.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast here
  };

  const PaginationControls = () => (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-700">
            <span className="hidden sm:inline">Showing </span>
            <span className="font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span>
            <span className="hidden sm:inline"> to </span>
            <span className="sm:hidden">-</span>
            <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, (currentPage - 1) * ITEMS_PER_PAGE + leads.length)}</span>
            <span className="hidden sm:inline"> results</span>
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1 || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={handleNextPage}
              disabled={!hasMore || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Next</span>
              <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );

  if (!canUseCrmInspector(userDoc)) {
    return (
      <div className="p-8 text-center bg-white rounded-lg border border-slate-200 shadow-sm">
        <p className="text-slate-500">Restricted Access</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar & Actions */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 items-center">
          <form onSubmit={handleSearch} className="relative flex-1">
            <input
              type="text"
              placeholder="Search by ID, Phone, Email, or Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border-slate-200 pl-10 pr-4 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm"
            />
            <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          </form>
          
          {isGlobalCrmView ? (
            <button
              onClick={handleFixLeads}
              disabled={maintenanceLoading}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Fix Titles & Backfill IDs"
            >
              <WrenchIcon className={`h-4 w-4 ${maintenanceLoading ? 'animate-spin' : ''}`} />
              {maintenanceLoading ? 'Fixing...' : 'Fix Leads'}
            </button>
          ) : null}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-end bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div className="w-48">
            <Select
              label="View Mode"
              value={viewMode}
              onChange={(val) => setViewMode(val as 'all' | 'revenue')}
              options={[
                { value: 'all', label: 'All Recent Leads' },
                { value: 'revenue', label: 'Revenue / Enrolled' },
              ]}
            />
          </div>

          <div className="w-48">
            <Select
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'new', label: 'New' },
                { value: 'hot', label: 'Hot' },
                { value: 'warm', label: 'Warm' },
                { value: 'cold', label: 'Cold' },
                { value: 'followup', label: 'Follow Up' },
                { value: 'PaymentFollowUp', label: 'Payment Follow Up' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </div>

          <div className="w-64">
            <SearchableCombobox
              label="Assigned To"
              value={assigneeFilter}
              onChange={setAssigneeFilter}
              options={[
                { value: 'all', label: 'All Employees' },
                { value: 'unassigned', label: 'Unassigned' },
                ...users.map(u => ({ value: u.uid, label: u.name }))
              ]}
              placeholder="Select employee..."
            />
          </div>

          <div className="w-56">
            <Select
              label="Sort By"
              value={sortOption}
              onChange={setSortOption}
              options={[
                { value: 'created_desc', label: 'Date Created (Newest)' },
                { value: 'created_asc', label: 'Date Created (Oldest)' },
                { value: 'updated_desc', label: 'Latest Activity (Newest)' },
                { value: 'updated_asc', label: 'Latest Activity (Oldest)' },
              ]}
            />
          </div>
          
          <div className="flex-1 text-right text-xs text-slate-500 self-center">
            Showing {sortedLeads.length} of {leads.length} results
          </div>
        </div>

        {viewMode === 'revenue' && !searchTerm ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Revenue view scans the most recent {REVENUE_SCAN_LIMIT} updated leads. Use search for older records.
          </div>
        ) : null}

        {/* Top Pagination */}
        {!searchTerm && (
           <div className="bg-slate-50 px-4 py-3 rounded-lg border border-slate-200">
             <PaginationControls />
           </div>
        )}
      </div>
         
         {searchError && (
           <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-100">
             {searchError}
           </div>
         )}

       <div className="overflow-hidden rounded-lg border border-slate-200">
         <div className="overflow-x-auto">
           <table className="min-w-full divide-y divide-slate-200">
             <thead className="bg-slate-50">
               <tr>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                   ID <span className="ml-1 text-slate-400">({sortedLeads.length})</span>
                 </th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Name & Phone</th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Assigned To</th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Created At</th>
                 <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
               </tr>
             </thead>
             <tbody className="bg-white divide-y divide-slate-200">
               {loading && leads.length === 0 ? (
                 <tr>
                   <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-500">
                     Loading...
                   </td>
                 </tr>
               ) : sortedLeads.length === 0 ? (
                 <tr>
                   <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-500">
                     {leads.length > 0 ? "No leads match the selected filters." : "No leads found."}
                   </td>
                 </tr>
               ) : (
                 sortedLeads.map((lead) => (
                   <tr key={lead.leadId} className="hover:bg-slate-50/50 transition-colors">
                     <td className="px-6 py-4 whitespace-nowrap">
                       <div className="flex items-center gap-2 group">
                         <span className="text-xs font-mono text-slate-500">
                           {lead.leadId.substring(0, 8)}...
                         </span>
                         <button 
                           onClick={() => copyToClipboard(lead.leadId)}
                           className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                           title="Copy ID"
                         >
                           <ClipboardDocumentIcon className="h-3 w-3" />
                         </button>
                       </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-900">{toTitleCase(lead.name)}</div>
                      <div className="text-xs text-slate-500">{lead.phone}</div>
                    </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                         lead.status === 'new' ? 'bg-blue-100 text-blue-800' :
                         lead.status === 'followup' ? 'bg-yellow-100 text-yellow-800' :
                         (lead.status === 'hot' || lead.status === 'warm') ? 'bg-purple-100 text-purple-800' :
                         lead.status === 'closed' ? 'bg-green-100 text-green-800' :
                         'bg-gray-100 text-gray-800'
                       }`}>
                         {lead.status}
                       </span>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                       <UserNameDisplay uid={lead.assignedTo} fallback="Unassigned" />
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                       {lead.createdAt ? (() => {
                         try {
                          const createdAt = lead.createdAt;
                          const date = createdAt instanceof Timestamp ? createdAt.toDate() : new Date(createdAt as string);
                          return format(date, 'MMM d, yyyy');
                        } catch {
                          return '-';
                        }
                       })() : '-'}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                       <button
                         onClick={() => onViewDetails(lead)}
                         className="text-indigo-600 hover:text-indigo-900 hover:underline"
                       >
                         View Details
                       </button>
                     </td>
                   </tr>
                 ))
               )}
             </tbody>
           </table>
         </div>
       </div>

       {/* Pagination Controls */}
       {!searchTerm && (
         <div className="px-4 py-3 sm:px-6 border-t border-slate-200">
            <PaginationControls />
         </div>
       )}
    </div>
  );
}
