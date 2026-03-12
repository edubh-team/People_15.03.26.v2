import { useState, useEffect } from 'react';
import { doc, updateDoc, onSnapshot, Timestamp, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { XMarkIcon, UserCircleIcon, AcademicCapIcon, IdentificationIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import { RoleBadge } from '@/components/RoleBadge';

type EmployeeDossierModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string | null; // This is the UID
};

type EmployeeData = {
  id: string;
  displayName?: string;
  email?: string;
  phoneNumber?: string; // Using phoneNumber to match user snippet, but check type
  phone?: string;       // Check if schema uses phone or phoneNumber
  photoURL?: string;
  role?: string;
  employeeId?: string;
  address?: string;
  aadhar?: string;
  pan?: string;
  university?: string;
  education?: string;
  createdAt?: Timestamp;
  lastLogin?: Timestamp; // Hypothetical field
  status?: string;
  orgRole?: string;
  reportsTo?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  kycDetails?: Record<string, unknown> | null;
  [key: string]: unknown;
};

// Helper Component for consistency
function InfoField({ 
  label, 
  value, 
  colSpan = 1, 
  isMono = false,
  isUppercase = false,
  isEditing = false,
  onChange 
}: { 
  label: string, 
  value?: string | number | null, 
  colSpan?: number, 
  isMono?: boolean,
  isUppercase?: boolean,
  isEditing?: boolean,
  onChange?: (val: string) => void
}) {
  return (
    <div className={colSpan === 2 ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className={`mt-1 text-sm text-gray-900 ${isMono ? 'font-mono' : ''} ${isUppercase ? 'uppercase' : ''}`}>
        {isEditing && onChange ? (
          <input
            type="text"
            className="w-full rounded-md border border-gray-300 px-2 py-1 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          value || '-'
        )}
      </dd>
    </div>
  );
}

export default function EmployeeDossierModal({ isOpen, onClose, employeeId }: EmployeeDossierModalProps) {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<EmployeeData>>({});
  const [saving, setSaving] = useState(false);
  const [reportsToName, setReportsToName] = useState<string | null>(null);
  const [assignedHRName, setAssignedHRName] = useState<string | null>(null);
  const [hrList, setHrList] = useState<EmployeeData[]>([]);

  // Fetch HR List
  useEffect(() => {
    if (!db || !isOpen) return;
    
    const fetchHRs = async () => {
        if (!db) return;
        try {
            // Broad query for HR-like roles
            const q = query(
                collection(db, 'users'), 
                where('status', '==', 'active')
            );
            const snapshot = await getDocs(q);
            const hrs: EmployeeData[] = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const r = (data.role || '').toUpperCase();
                const or = (data.orgRole || '').toUpperCase();
                
                if (
                    r.includes('HR') || or.includes('HR') || 
                    r === 'SUPER_ADMIN' || or === 'SUPER_ADMIN' ||
                    r === 'ADMIN' || or === 'ADMIN'
                ) {
                    hrs.push({ id: doc.id, ...data } as EmployeeData);
                }
            });
            setHrList(hrs);
        } catch (error) {
            console.error("Error fetching HR list:", error);
        }
    };
    
    fetchHRs();
  }, [isOpen]);

  // 1. DATA FETCHING (Single Source of Truth)
  useEffect(() => {
    if (!isOpen || !employeeId) return;
    
    // Reset editing state on open
    setIsEditing(false);
    setFormData({});

    // Check if db is initialized
    if (!db) {
      console.error("Firestore instance not initialized");
      return;
    }

    setLoading(true);
    const docRef = doc(db, 'users', employeeId);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Flatten nested KYC details for the form
        const kyc = data.kycDetails || {};
        
        setEmployee({ 
          id: docSnap.id, 
          ...data,
          // Explicitly map KYC fields to flat structure with fallbacks for legacy root data
          aadhar: kyc.aadhar || data.aadhar,
          pan: kyc.pan || data.pan,
          university: kyc.university || data.university,
          education: kyc.education || data.education,
          bankAccountNo: kyc.bankAccount || data.bankAccountNo || data.bankAccount,
          ifscCode: kyc.ifsc || data.ifscCode || data.ifsc,
          // Ensure phone is consistent
          phone: data.phone || data.phoneNumber,
        } as EmployeeData);
      } else {
        console.log("No such document!");
        setEmployee(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching dossier:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen, employeeId]);

  // Fetch Reports To Name and HR Name
  useEffect(() => {
    if (!db) return;

    if (employee?.reportsTo) {
      getDoc(doc(db, 'users', employee.reportsTo)).then((snap) => {
        if (snap.exists()) {
          setReportsToName(snap.data().displayName || "Unknown");
        } else {
          setReportsToName("Unknown User");
        }
      }).catch((err) => {
        console.error(err);
        setReportsToName("Error loading name");
      });
    } else {
      setReportsToName(null);
    }

    if (employee?.assignedHR) {
      getDoc(doc(db, 'users', employee.assignedHR as string)).then((snap) => {
        if (snap.exists()) {
            setAssignedHRName(snap.data().displayName || "Unknown");
        } else {
            setAssignedHRName("Unknown User");
        }
      }).catch((err) => {
        console.error(err);
        setAssignedHRName("Error loading name");
      });
    } else {
        setAssignedHRName(null);
    }
  }, [employee?.reportsTo, employee?.assignedHR]);

  const handleEditClick = () => {
    if (employee) {
      setFormData({ ...employee });
      setIsEditing(true);
    }
  };

  const handleCancelClick = () => {
    setIsEditing(false);
    setFormData({});
  };

  const handleInputChange = (field: keyof EmployeeData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!employeeId || !db) return;
    setSaving(true);
    try {
      const docRef = doc(db, 'users', employeeId);
      
      // Destructure to separate root fields from KYC fields and cleanup
      const { 
        id, 
        kycDetails, // Exclude the nested object to avoid overwriting with stale data
        aadhar, 
        pan, 
        university, 
        education, 
        bankAccountNo, 
        ifscCode, 
        ...rootFields 
      } = formData;

      const updatePayload: Record<string, unknown> = { ...rootFields };
      
      // Helper to ensure we don't send undefined to Firestore
      const sanitize = (val: unknown) => val === undefined ? null : val;

      // Map flat KYC fields back to nested structure using dot notation
      updatePayload['kycDetails.aadhar'] = sanitize(aadhar);
      updatePayload['kycDetails.pan'] = sanitize(pan);
      updatePayload['kycDetails.university'] = sanitize(university);
      updatePayload['kycDetails.education'] = sanitize(education);
      updatePayload['kycDetails.bankAccount'] = sanitize(bankAccountNo);
      updatePayload['kycDetails.ifsc'] = sanitize(ifscCode);
      
      await updateDoc(docRef, updatePayload);
      
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* BACKDROP */}
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* MODAL CONTAINER (Flex Sandwich Pattern) */}
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
        
        {/* A. HEADER (Fixed) */}
        <div className="flex-none bg-slate-50/80 backdrop-blur p-6 border-b border-slate-100 flex justify-between items-start">
           <div className="flex gap-5">
             <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 ring-4 ring-white shadow-sm overflow-hidden">
                {/* Avatar / Initials */}
                {employee?.photoURL ? (
                  <div className="relative w-full h-full">
                    <Image src={employee.photoURL} alt={employee.displayName || "Employee"} fill className="object-cover" />
                  </div>
                ) : (
                  <UserCircleIcon className="w-12 h-12" />
                )}
             </div>
             <div className="pt-1">
               <h2 className="text-2xl font-bold text-slate-900">{loading ? 'Loading...' : (employee?.displayName || 'Unknown Employee')}</h2>
               <div className="flex items-center gap-2 mt-2">
                 <RoleBadge role={employee?.role || 'Employee'} />
                 <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                   ID: {employee?.employeeId || 'N/A'}
                 </span>
                 <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                   employee?.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                 }`}>
                   {employee?.status || 'Unknown'}
                 </span>
               </div>
             </div>
           </div>
           <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
             <XMarkIcon className="w-6 h-6" />
           </button>
        </div>

        {/* B. SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto bg-white p-8 scroll-smooth">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-4"></div>
              <p>Fetching Personnel Dossier...</p>
            </div>
          ) : (
            <div className="grid gap-10">
              
              {/* Section 1: Contact & Identity */}
              <section>
                <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-2">
                  <IdentificationIcon className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Identity & Contact
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <InfoField label="Email Address" value={isEditing ? formData.email : employee?.email} isEditing={isEditing} onChange={(v) => handleInputChange('email', v)} />
                  <InfoField label="Phone Number" value={isEditing ? (formData.phone || formData.phoneNumber) : (employee?.phone || employee?.phoneNumber)} isEditing={isEditing} onChange={(v) => handleInputChange('phone', v)} />
                  <InfoField label="Work Role" value={isEditing ? formData.role : employee?.role} isUppercase isEditing={isEditing} onChange={(v) => handleInputChange('role', v)} />
                  <InfoField label="Organization Role" value={isEditing ? formData.orgRole : employee?.orgRole} isUppercase isEditing={isEditing} onChange={(v) => handleInputChange('orgRole', v)} />
                  <InfoField label="Reports To" value={isEditing ? formData.reportsTo : (reportsToName || (employee?.reportsTo ? 'Loading...' : 'N/A'))} isEditing={isEditing} onChange={(v) => handleInputChange('reportsTo', v)} />
                  
                  {isEditing ? (
                    <div>
                      <dt className="text-xs font-medium text-gray-500">Assigned HR</dt>
                      <dd className="mt-1">
                        <select
                          className="w-full rounded-md border border-gray-300 px-2 py-1 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm bg-white"
                          value={(formData.assignedHR as string) || ""}
                          onChange={(e) => handleInputChange('assignedHR', e.target.value)}
                        >
                          <option value="">— No HR Assigned —</option>
                          {hrList.map(hr => (
                            <option key={hr.id} value={hr.id}>
                              {hr.displayName || hr.email} {hr.role ? `(${hr.role})` : ''}
                            </option>
                          ))}
                        </select>
                      </dd>
                    </div>
                  ) : (
                    <InfoField label="Assigned HR" value={assignedHRName || (employee?.assignedHR ? 'Loading...' : 'N/A')} />
                  )}

                  <InfoField label="Current Address" value={isEditing ? formData.address : employee?.address} colSpan={2} isEditing={isEditing} onChange={(v) => handleInputChange('address', v)} />
                </div>
              </section>

              {/* Section 2: KYC & Official Details */}
              <section>
                <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-2">
                  <AcademicCapIcon className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    KYC & Qualifications
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <InfoField label="Aadhar Number" value={isEditing ? formData.aadhar : employee?.aadhar} isMono isEditing={isEditing} onChange={(v) => handleInputChange('aadhar', v)} />
                  <InfoField label="PAN Card" value={isEditing ? formData.pan : employee?.pan} isMono isEditing={isEditing} onChange={(v) => handleInputChange('pan', v)} />
                  <InfoField label="University/College" value={isEditing ? formData.university : employee?.university} isEditing={isEditing} onChange={(v) => handleInputChange('university', v)} />
                  <InfoField label="Highest Education" value={isEditing ? formData.education : employee?.education} isEditing={isEditing} onChange={(v) => handleInputChange('education', v)} />
                  <InfoField label="Bank Account" value={isEditing ? formData.bankAccountNo : (employee?.bankAccountNo || '—')} isMono isEditing={isEditing} onChange={(v) => handleInputChange('bankAccountNo', v)} />
                  <InfoField label="IFSC Code" value={isEditing ? formData.ifscCode : (employee?.ifscCode || '—')} isMono isEditing={isEditing} onChange={(v) => handleInputChange('ifscCode', v)} />
                </div>
              </section>

              {/* Section 3: System Metadata */}
              <section className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="grid grid-cols-2 gap-4 text-xs">
                   <div>
                     <span className="block text-gray-500">Account Created</span>
                     <span className="font-medium">{employee?.createdAt?.toDate ? employee.createdAt.toDate().toLocaleDateString() : '—'}</span>
                   </div>
                   <div>
                     <span className="block text-gray-500">Last Active</span>
                     <span className="font-medium">{employee?.lastLogin?.toDate ? employee.lastLogin.toDate().toLocaleString() : 'Never'}</span>
                   </div>
                </div>
              </section>

            </div>
          )}
        </div>
        
        {/* C. FOOTER (Fixed) */}
        <div className="flex-none p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          {isEditing ? (
            <>
              <button 
                onClick={handleCancelClick}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded-lg border border-transparent hover:border-gray-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded-lg border border-transparent hover:border-gray-200 transition-all">
                Close View
              </button>
              <button 
                onClick={handleEditClick}
                className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800"
              >
                Edit Profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
