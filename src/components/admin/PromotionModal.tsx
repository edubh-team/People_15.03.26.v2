import { useState, useMemo } from "react";

// 1. DEFINE THE STRICT HIERARCHY
// Note: 'Super Admin' is deliberately excluded from this list.
const PROMOTION_TIERS = [
  { label: 'Executive', value: 'EMPLOYEE', level: 1 },
  { label: 'Team Lead', value: 'TEAM_LEAD', level: 2 },
  { label: 'Manager', value: 'MANAGER', level: 3 }
];

type Props = {
  currentUser: {
    uid: string;
    name: string;
    role: string; // "EMPLOYEE" | "TEAM_LEAD" | "MANAGER"
  };
  performanceScore?: number; // Optional prop, defaults to 0
  isOpen: boolean;
  onClose: () => void;
  onPromote?: (newRole: string) => void;
};

export default function PromotionModal({ currentUser, performanceScore = 0, isOpen, onClose, onPromote }: Props) {
  // currentUser.role is the "Working Role" (e.g., 'EMPLOYEE')
  
  // 2. HELPER: Get Next Available Roles
  const promotableOptions = useMemo(() => {
    const getPromotableRoles = (currentRoleValue: string) => {
      // Normalize input role to match PROMOTION_TIERS values if necessary
      const normalizedRole = 
        currentRoleValue === 'employee' ? 'EMPLOYEE' :
        currentRoleValue === 'teamLead' ? 'TEAM_LEAD' :
        currentRoleValue === 'manager' ? 'MANAGER' : 
        currentRoleValue; // Fallback

      const currentTier = PROMOTION_TIERS.find(t => t.value === normalizedRole);
      
      if (!currentTier) return []; // Unknown role

      // Filter for roles strictly HIGHER than current, but DO NOT include Super Admin
      return PROMOTION_TIERS.filter(t => t.level > currentTier.level);
    };

    return getPromotableRoles(currentUser.role);
  }, [currentUser.role]);

  const [selectedRole, setSelectedRole] = useState(() => {
    return promotableOptions.length > 0 ? promotableOptions[0].value : "";
  });
  const [prevUserRole, setPrevUserRole] = useState(currentUser.role);

  // Auto-select the first promotable option when currentUser.role changes
  if (currentUser.role !== prevUserRole) {
    setPrevUserRole(currentUser.role);
    setSelectedRole(promotableOptions.length > 0 ? promotableOptions[0].value : "");
  }

  const isMaxLevel = promotableOptions.length === 0;

  // --- START PROMOTION METER LOGIC ---
  const getNormalizedRole = (role: string) => {
     return role === 'employee' ? 'EMPLOYEE' :
            role === 'teamLead' ? 'TEAM_LEAD' :
            role === 'manager' ? 'MANAGER' : role;
  };

  const currentRoleNormalized = getNormalizedRole(currentUser.role);
  // Removed unused currentLevel variable

  const getNextRoleLabel = (role: string) => {
    if (role === 'EMPLOYEE') return 'Team Lead';
    if (role === 'TEAM_LEAD') return 'Manager';
    return 'Max Level Reached';
  };
  // --- END PROMOTION METER LOGIC ---

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-6">
           <div className="flex justify-between items-center mb-4">
             <h2 className="text-lg font-bold text-slate-900">Promote {currentUser.name}</h2>
             <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
               <span className="sr-only">Close</span>
               <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
               </svg>
             </button>
           </div>

           {/* PROMOTION METER */}
           <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100">
             {currentRoleNormalized === 'MANAGER' ? (
               <div className="text-green-600 font-bold flex items-center gap-2 justify-center">
                 <span>Max Level Reached</span>
                 <span>🏆</span>
               </div>
             ) : (
               <div className="w-full">
                 <div className="flex justify-between text-xs font-semibold mb-1 text-slate-600">
                   <span className="capitalize">Current: {currentRoleNormalized.toLowerCase().replace('_', ' ')}</span>
                   <span>Target: {getNextRoleLabel(currentRoleNormalized)}</span>
                 </div>
                 
                 <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden mt-2">
                   <div 
                     className="bg-indigo-600 h-3 rounded-full transition-all duration-500" 
                     style={{ width: `${performanceScore}%` }} 
                   />
                 </div>
                 <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                   {performanceScore}% progress to next promotion
                 </p>
               </div>
             )}
           </div>
           
           {isMaxLevel ? (
             // CASE A: User is already a Manager
             <div className="p-4 bg-amber-50 text-amber-800 rounded-lg border border-amber-200">
               <p className="font-semibold flex items-center gap-2">
                 <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                 </svg>
                 Maximum Level Reached
               </p>
               <p className="text-sm mt-2 ml-7">
                 This user is already at the highest promotable level (Manager).
                 Super Admin access must be granted manually via the database.
               </p>
             </div>
           ) : (
             // CASE B: User can be promoted
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select New Role</label>
                <select 
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                >
                  {promotableOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <button 
                onClick={() => onPromote?.(selectedRole)}
                disabled={!selectedRole}
                className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold hover:bg-indigo-500 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Promotion
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
