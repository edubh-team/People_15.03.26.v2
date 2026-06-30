"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "@e965/xlsx";
import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { findBulkLeadDuplicateCandidates, type LeadDuplicateCandidate, normalizeLeadEmail, normalizeLeadName, normalizeLeadPhone } from "@/lib/crm/dedupe";
import { buildLeadActor, buildLeadHistoryEntry } from "@/lib/crm/timeline";
import { buildLeadCustodyDefaults } from "@/lib/crm/custody";
import { buildLeadIdentityFields } from "@/lib/firebase/leads";
import type { LeadDoc, LeadStatus } from "@/lib/types/crm";
import { toStoredLeadStatus } from "@/lib/leads/status";
import { 
  CloudArrowUpIcon, 
  DocumentArrowDownIcon, 
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon
} from "@heroicons/react/24/outline";
import { toTitleCase, generateLeadId } from "@/lib/utils/stringUtils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type PreviewLead = LeadDoc & {
  previewKey: string;
  sourceRowNumber: number;
};

type DuplicateFilter = "all" | "clean" | "flagged";
type ImportBatchStatus = "processing" | "completed" | "failed";

type ImportBatchRow = {
  id: string;
  fileName: string | null;
  sourceTag: string | null;
  tags: string[];
  totalRows: number;
  eligibleRows: number;
  importedRows: number;
  skippedRows: number;
  duplicateFlaggedRows: number;
  status: ImportBatchStatus;
  createdByUid: string | null;
  createdByName: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

function parseTagList(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => toTitleCase(value)),
    ),
  );
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateValue(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const parsed = maybeTimestamp.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = (value as { seconds?: unknown }).seconds;
    if (typeof seconds === "number") {
      const parsed = new Date(seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatDateLabel(value: unknown) {
  const dateValue = toDateValue(value);
  if (!dateValue) return "Just now";
  return dateValue.toLocaleString();
}

function normalizeBatchRow(id: string, data: DocumentData): ImportBatchRow {
  return {
    id,
    fileName: typeof data.fileName === "string" ? data.fileName : null,
    sourceTag: typeof data.sourceTag === "string" ? data.sourceTag : null,
    tags: toStringArray(data.tags),
    totalRows: toNumber(data.totalRows),
    eligibleRows: toNumber(data.eligibleRows),
    importedRows: toNumber(data.importedRows),
    skippedRows: toNumber(data.skippedRows),
    duplicateFlaggedRows: toNumber(data.duplicateFlaggedRows),
    status: data.status === "completed" || data.status === "failed" ? data.status : "processing",
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : null,
    createdByName: typeof data.createdByName === "string" ? data.createdByName : null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

// Removed unused ParsedRow type
export function LeadImportModal({ isOpen, onClose, onSuccess }: Props) {
  const { firebaseUser, userDoc } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewLead[]>([]);
  const [externalDuplicates, setExternalDuplicates] = useState<Record<string, LeadDuplicateCandidate[]>>({});
  const [internalDuplicateKeys, setInternalDuplicateKeys] = useState<string[]>([]);
  const [skipPotentialDuplicates, setSkipPotentialDuplicates] = useState(true);
  const [duplicateFilter, setDuplicateFilter] = useState<DuplicateFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [sourceTag, setSourceTag] = useState("");
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [recentBatches, setRecentBatches] = useState<ImportBatchRow[]>([]);
  const [recentBatchesLoading, setRecentBatchesLoading] = useState(false);
  const [recentBatchesError, setRecentBatchesError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parsedTags = useMemo(() => parseTagList(batchTagsInput), [batchTagsInput]);

  useEffect(() => {
    if (!isOpen || !db) return;
    let active = true;
    setRecentBatchesLoading(true);
    setRecentBatchesError(null);
    getDocs(query(collection(db, "crm_import_batches"), orderBy("createdAt", "desc"), limit(10)))
      .then((snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((row) =>
          normalizeBatchRow(row.id, row.data() as DocumentData),
        );
        setRecentBatches(rows);
        setRecentBatchesLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        if ((err as { code?: string }).code === "permission-denied") {
          setRecentBatches([]);
          setRecentBatchesLoading(false);
          setRecentBatchesError(null);
          return;
        }
        setRecentBatches([]);
        setRecentBatchesLoading(false);
        setRecentBatchesError(err instanceof Error ? err.message : "Unable to load batch logs.");
      });

    return () => {
      active = false;
    };
  }, [isOpen, firebaseUser?.uid]);

  function resetImportState() {
    setFile(null);
    setPreview([]);
    setExternalDuplicates({});
    setInternalDuplicateKeys([]);
    setDuplicateFilter("all");
    setSkipPotentialDuplicates(true);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.match(/\.(xlsx|csv)$/)) {
      setError("Invalid file type. Please upload an .xlsx or .csv file.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    processFile(selected);
  };

  const processFile = async (f: File) => {
    setFile(f);
    setError(null);
    setPreview([]);
    setExternalDuplicates({});
    setInternalDuplicateKeys([]);
    setDuplicateFilter("all");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const binaryStr = e.target?.result;
        // 1. Read the workbook
        const workbook = XLSX.read(binaryStr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // 2. Convert to JSON (Header: 1 gives us array of arrays, which is safer)
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

        if (!rawData || rawData.length < 2) {
          setError("File is empty or missing headers.");
          return;
        }

        // 3. Extract Headers & Data
        const [headers, ...rows] = rawData;

        // 4. Map Column Indices (The "Production" way)
        const getIndex = (keywords: string[]) => 
          headers.findIndex((h: unknown) => 
            keywords.some(k => String(h).toLowerCase().includes(k)) 
          );

        const nameIdx = getIndex(['name', 'student', 'lead']);
        const emailIdx = getIndex(['email', 'mail']);
        const phoneIdx = getIndex(['phone', 'mobile', 'contact']);
        const programIdx = getIndex(['program', 'degree', 'course']);
        const specIdx = getIndex(['specialization', 'stream']);
        const universityIdx = getIndex(['university', 'college', 'campus', 'uni']);
        const locationIdx = getIndex(['location', 'city', 'state', 'zone']);
        const languageIdx = getIndex(['language', 'lang']);
        const feeIdx = getIndex(['fee', 'amount', 'price', 'cost']);
        const statusIdx = getIndex(['status']);
        const remarksIdx = getIndex(['remark', 'note']);

        // 5. Construct Clean Objects
        const leads: PreviewLead[] = rows
          .filter(row => row[nameIdx] || row[emailIdx]) // Filter empty rows
          .map((row, rowIndex) => {
            const getStr = (idx: number): string => {
              const val = row[idx];
              return (val !== undefined && val !== null) ? String(val).trim() : "";
            };

            const rawFee = getStr(feeIdx);
            const parsedFee = rawFee ? parseFloat(rawFee.replace(/[^0-9.]/g, '')) : null;
            const leadLocation = toTitleCase(getStr(locationIdx));
            const preferredLanguage = toTitleCase(getStr(languageIdx));
            const contextualLeadTags = Array.from(
              new Set(
                [
                  leadLocation ? `Location: ${leadLocation}` : null,
                  preferredLanguage ? `Language: ${preferredLanguage}` : null,
                ].filter(Boolean) as string[],
              ),
            );

            return {
              previewKey: `preview-${rowIndex}-${generateLeadId()}`,
              sourceRowNumber: rowIndex + 2,
              leadId: generateLeadId(),
              name: toTitleCase(getStr(nameIdx) || "Unknown"),
              phone: getStr(phoneIdx),
              email: getStr(emailIdx),
              targetDegree: getStr(programIdx) || null,
              targetUniversity: getStr(universityIdx) || getStr(specIdx) || null,
              leadLocation: leadLocation || null,
              preferredLanguage: preferredLanguage || null,
              currentEducation: null,
              courseFees: isNaN(parsedFee || NaN) ? null : parsedFee,
              status: toStoredLeadStatus(getStr(statusIdx)) as LeadStatus,
              assignedTo: null,
              ownerUid: null,
              leadTags: contextualLeadTags.length > 0 ? contextualLeadTags : null,
              leadTagsNormalized:
                contextualLeadTags.length > 0
                  ? contextualLeadTags.map((tag) => tag.toLowerCase())
                  : null,
              kycData: { aadhar: null, pan: null, address: null, parentDetails: null },
              activityHistory: getStr(remarksIdx)
                ? [{ type: "created" as const, at: new Date().toISOString(), note: getStr(remarksIdx) }]
                : [],
              history: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          });

        if (leads.length === 0) {
          setError("No valid data found. Please check column headers.");
          return;
        }

        const keyMap = new Map<string, string[]>();
        leads.forEach((lead) => {
          const duplicateKeys = [
            normalizeLeadPhone(lead.phone),
            normalizeLeadEmail(lead.email),
            `${normalizeLeadName(lead.name)}::${normalizeLeadName(lead.targetUniversity)}`,
          ].filter(Boolean) as string[];

          duplicateKeys.forEach((duplicateKey) => {
            const bucket = keyMap.get(duplicateKey) ?? [];
            keyMap.set(duplicateKey, [...bucket, lead.previewKey]);
          });
        });

        const internalFlags = Array.from(
          new Set(
            Array.from(keyMap.values())
              .filter((bucket) => bucket.length > 1)
              .flat(),
          ),
        );

        const duplicateResults = await findBulkLeadDuplicateCandidates(
          leads.map((lead) => ({
            key: lead.previewKey,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            targetUniversity: lead.targetUniversity,
            targetDegree: lead.targetDegree,
          })),
        );

        setInternalDuplicateKeys(internalFlags);
        setExternalDuplicates(
          Object.fromEntries(Array.from(duplicateResults.entries())),
        );
        setPreview(leads);
      } catch (err) {
        console.error("Parse Error:", err);
        setError("Failed to parse file. Please check the format.");
      }
    };
    reader.readAsBinaryString(f);
  };

  const internalDuplicateSet = useMemo(
    () => new Set(internalDuplicateKeys),
    [internalDuplicateKeys],
  );

  const previewRows = useMemo(
    () =>
      preview.map((lead) => {
        const externalMatches = externalDuplicates[lead.previewKey] ?? [];
        const isInternalDuplicate = internalDuplicateSet.has(lead.previewKey);
        const isFlagged = isInternalDuplicate || externalMatches.length > 0;
        const willSkip = skipPotentialDuplicates && isFlagged;
        return {
          ...lead,
          externalMatches,
          isInternalDuplicate,
          isFlagged,
          willSkip,
        };
      }),
    [externalDuplicates, internalDuplicateSet, preview, skipPotentialDuplicates],
  );

  const importSummary = useMemo(() => {
    const total = previewRows.length;
    const flagged = previewRows.filter((row) => row.isFlagged).length;
    const clean = total - flagged;
    const willSkip = previewRows.filter((row) => row.willSkip).length;
    const willImport = total - willSkip;

    return { total, flagged, clean, willImport, willSkip };
  }, [previewRows]);

  const filteredPreviewRows = useMemo(() => {
    const rows = previewRows.filter((row) => {
      switch (duplicateFilter) {
        case "clean":
          return !row.isFlagged;
        case "flagged":
          return row.isFlagged;
        default:
          return true;
      }
    });

    return rows.slice(0, 75);
  }, [duplicateFilter, previewRows]);

  const handleUpload = async () => {
    if (preview.length === 0 || !db) return;
    const normalizedSourceTag = sourceTag.trim();
    const normalizedCampaignName = campaignName.trim();
    if (!normalizedSourceTag) {
      setError("Source tag is required before importing leads.");
      return;
    }
    if (parsedTags.length === 0) {
      setError("Add at least one batch tag to track this upload.");
      return;
    }

    const firestore = db;
    setLoading(true);
    setProgress(0);
    setError(null);
    let importBatchRef: ReturnType<typeof doc> | null = null;
    let processed = 0;
    let autoAssignedRows = 0;

    try {
      const uploaderUid = userDoc?.uid ?? firebaseUser?.uid ?? null;
      if (!uploaderUid) {
        throw new Error("User session missing. Please re-login before importing.");
      }
      const actor = buildLeadActor({
        uid: uploaderUid,
        displayName: userDoc?.displayName ?? firebaseUser?.email ?? "Bulk Import",
        email: userDoc?.email ?? firebaseUser?.email ?? null,
        role: userDoc?.role ?? null,
        orgRole: userDoc?.orgRole ?? null,
        employeeId: userDoc?.employeeId ?? null,
      });
      const eligibleLeads = preview.filter((lead) => {
        const hasExternalDuplicates = (externalDuplicates[lead.previewKey] ?? []).length > 0;
        return !(skipPotentialDuplicates && (internalDuplicateSet.has(lead.previewKey) || hasExternalDuplicates));
      });
      const eligibleTotal = eligibleLeads.length;
      if (eligibleTotal === 0) {
        throw new Error("Every row was flagged as a potential duplicate. Review duplicates or disable duplicate skipping.");
      }

      importBatchRef = doc(collection(firestore, "crm_import_batches"));
      const importBatchId = importBatchRef.id;
      const normalizedTags = parsedTags.map((tag) => tag.toLowerCase());
      await setDoc(importBatchRef, {
        batchId: importBatchId,
        fileName: file?.name ?? null,
        sourceTag: normalizedSourceTag,
        campaignName: normalizedCampaignName || null,
        tags: parsedTags,
        tagsNormalized: normalizedTags,
        createdByUid: actor.uid,
        createdByName: actor.name ?? actor.uid,
        createdByRole: userDoc?.orgRole ?? userDoc?.role ?? null,
        status: "processing",
        totalRows: preview.length,
        eligibleRows: eligibleTotal,
        importedRows: 0,
        skippedRows: preview.length - eligibleTotal,
        duplicateFlaggedRows: importSummary.flagged,
        autoAssignedRows: 0,
        progressPercent: 0,
        skipPotentialDuplicates,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        startedAt: serverTimestamp(),
      });

      const BATCH_SIZE = 200;
      const chunks = [];
      for (let i = 0; i < eligibleLeads.length; i += BATCH_SIZE) {
        chunks.push(eligibleLeads.slice(i, i + BATCH_SIZE));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(firestore);
        let chunkProcessed = 0;
        chunk.forEach((lead) => {
          const externalMatches = externalDuplicates[lead.previewKey] ?? [];
          const duplicateReasons = Array.from(
            new Set([
              ...(internalDuplicateSet.has(lead.previewKey) ? ["Duplicate row inside import file"] : []),
              ...externalMatches.flatMap((candidate) => candidate.reasons),
            ]),
          );

          const persistedLead = { ...lead } as LeadDoc & { previewKey?: string };
          delete persistedLead.previewKey;
          const assigneeUid = uploaderUid;
          if (assigneeUid) autoAssignedRows += 1;
          const contextualLeadTags = toStringArray(lead.leadTags);
          const contextualLeadTagsNormalized = contextualLeadTags.map((tag) => tag.toLowerCase());
          const mergedLeadTags = Array.from(new Set([...parsedTags, ...contextualLeadTags]));
          const mergedLeadTagsNormalized = Array.from(
            new Set([...normalizedTags, ...contextualLeadTagsNormalized]),
          );
          const ref = doc(collection(firestore, "leads"), lead.leadId); // Use custom ID as doc ID
          const timelineRef = doc(collection(firestore, "leads", lead.leadId, "timeline"));
          batch.set(ref, {
            ...persistedLead,
            ...buildLeadIdentityFields({
              name: lead.name,
              phone: lead.phone,
              email: lead.email,
            }),
            assignedTo: assigneeUid,
            ownerUid: assigneeUid,
            assignedBy: assigneeUid ? actor.uid : null,
            assignedAt: assigneeUid ? serverTimestamp() : null,
            ...buildLeadCustodyDefaults({
              ownerUid: assigneeUid,
              actor,
              reason: assigneeUid ? "Imported and assigned" : "Imported into shared pool",
              state: assigneeUid ? "owned" : "pooled",
            }),
            source: normalizedSourceTag,
            sourceNormalized: normalizedSourceTag.toLowerCase(),
            campaignName: normalizedCampaignName || null,
            importBatchId,
            importTags: parsedTags,
            importTagsNormalized: normalizedTags,
            leadTags: mergedLeadTags.length > 0 ? mergedLeadTags : null,
            leadTagsNormalized:
              mergedLeadTagsNormalized.length > 0 ? mergedLeadTagsNormalized : null,
            importFileName: file?.name ?? null,
            importedBy: actor,
            importedAt: serverTimestamp(),
            duplicateFlag: duplicateReasons.length > 0,
            duplicateReasons: duplicateReasons.length > 0 ? duplicateReasons : null,
            duplicateCandidateLeadIds:
              externalMatches.length > 0
                ? externalMatches.map((candidate) => candidate.lead.leadId)
                : null,
            duplicateScore: externalMatches[0]?.score ?? (duplicateReasons.length > 0 ? 40 : null),
            duplicateDetectedAt: duplicateReasons.length > 0 ? serverTimestamp() : null,
            duplicateDetectionSource: duplicateReasons.length > 0 ? "import" : null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            activityHistory: lead.activityHistory.map(a => ({ ...a, at: new Date().toISOString() })),
            history: [
              buildLeadHistoryEntry({
                action: "Lead Imported",
                actor,
                newStatus: String(lead.status),
                remarks: `Imported from ${file?.name ?? "spreadsheet"} [batch ${importBatchId}]`,
              }),
            ],
          });
          batch.set(timelineRef, {
            type: "created",
            summary: "Lead imported to uploader queue",
            actor,
            metadata: {
              source: "bulk_import",
              fileName: file?.name ?? null,
              sourceTag: normalizedSourceTag,
              campaignName: normalizedCampaignName || null,
              importBatchId,
              importTags: parsedTags,
              contextualTags: contextualLeadTags,
              leadLocation: lead.leadLocation ?? null,
              preferredLanguage: lead.preferredLanguage ?? null,
              assignedTo: assigneeUid,
              routingMode: "uploader_queue",
              duplicateFlag: duplicateReasons.length > 0,
              duplicateReasons: duplicateReasons.length > 0 ? duplicateReasons.join(" | ") : null,
            },
            createdAt: serverTimestamp(),
          });
          processed += 1;
          chunkProcessed += 1;
        });

        if (chunkProcessed > 0) {
          await batch.commit();
        }

        const currentProgress = eligibleTotal > 0 ? Math.round((processed / eligibleTotal) * 100) : 0;
        setProgress(currentProgress);
        if (importBatchRef) {
          await updateDoc(importBatchRef, {
            importedRows: processed,
            autoAssignedRows,
            progressPercent: currentProgress,
            status: processed >= eligibleTotal ? "completed" : "processing",
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (importBatchRef) {
        await updateDoc(importBatchRef, {
          status: "completed",
          importedRows: processed,
          autoAssignedRows,
          progressPercent: 100,
          finishedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      onSuccess();
      resetImportState();
      onClose();
    } catch (err) {
      console.error("Upload Error:", err);
      if (importBatchRef) {
        try {
          const failedProgressPercent = importSummary.willImport > 0
            ? Math.round((processed / importSummary.willImport) * 100)
            : 0;
          await updateDoc(importBatchRef, {
            status: "failed",
            importedRows: processed,
            autoAssignedRows,
            progressPercent: failedProgressPercent,
            errorMessage: err instanceof Error ? err.message : "Unknown import error",
            updatedAt: serverTimestamp(),
            failedAt: serverTimestamp(),
          });
        } catch (batchUpdateError) {
          console.error("Failed to update import batch failure status", batchUpdateError);
        }
      }
      setError(err instanceof Error ? err.message : "Failed to upload leads. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const headers = [
      "Lead Name",
      "Phone Number",
      "Email",
      "Program",
      "Specialization",
      "Location",
      "Language",
      "Status",
      "Remarks",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Leads_Import_Template.xlsx");
  };

  const canSubmitImport =
    Boolean(file) &&
    !loading &&
    preview.length > 0 &&
    importSummary.willImport > 0 &&
    sourceTag.trim().length > 0 &&
    parsedTags.length > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Leads</h2>
            <p className="text-sm text-slate-500">Bulk upload via Excel or CSV</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-500">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-sm font-semibold text-slate-900">Batch tagging (required)</div>
            <div className="mt-1 text-xs text-slate-500">
              Add source and tags now so this upload can be searched and tracked as one batch.
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Source Tag *
                </span>
                <input
                  type="text"
                  value={sourceTag}
                  onChange={(event) => setSourceTag(event.target.value)}
                  placeholder="Example: Meta Ads, Walk-in, Partner"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Campaign (Optional)
                </span>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="Example: March Intake"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Batch Tags *
                </span>
                <input
                  type="text"
                  value={batchTagsInput}
                  onChange={(event) => setBatchTagsInput(event.target.value)}
                  placeholder="Comma separated: march, btech, north_zone"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
            </div>
            {parsedTags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {parsedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-xs text-amber-700">
                Add at least one batch tag to enable import.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Recent import batches</div>
                <div className="text-xs text-slate-500">
                  Track progress, source tags, and rows imported per batch.
                </div>
              </div>
            </div>
            <div className="max-h-48 overflow-auto px-4 py-3">
              {recentBatchesLoading ? (
                <div className="text-xs text-slate-500">Loading import batches...</div>
              ) : recentBatchesError ? (
                <div className="text-xs text-rose-600">{recentBatchesError}</div>
              ) : recentBatches.length === 0 ? (
                <div className="text-xs text-slate-500">No import batches found yet.</div>
              ) : (
                <div className="space-y-2">
                  {recentBatches.map((batchRow) => {
                    const progressPercent = batchRow.eligibleRows > 0
                      ? Math.round((batchRow.importedRows / batchRow.eligibleRows) * 100)
                      : 0;
                    return (
                      <div key={batchRow.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-slate-900">
                              {batchRow.fileName ?? "Spreadsheet import"}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                              <span>{batchRow.sourceTag ?? "-"}</span>
                              <span>{batchRow.importedRows}/{batchRow.eligibleRows || batchRow.totalRows} imported</span>
                              <span>{formatDateLabel(batchRow.updatedAt || batchRow.createdAt)}</span>
                            </div>
                          </div>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              batchRow.status === "completed"
                                ? "bg-emerald-100 text-emerald-700"
                                : batchRow.status === "failed"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {batchRow.status}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                          <div
                            className="h-1.5 rounded-full bg-indigo-500"
                            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                          />
                        </div>
                        {batchRow.tags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {batchRow.tags.map((tag) => (
                              <span
                                key={`${batchRow.id}-${tag}`}
                                className="inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

      {!file ? (
            <div 
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-12 transition-colors hover:border-indigo-500 hover:bg-indigo-50/50 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="rounded-full bg-indigo-100 p-4 text-indigo-600">
                <CloudArrowUpIcon className="h-8 w-8" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-900">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-slate-500">.xlsx or .csv files only</p>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".xlsx,.csv" 
                className="hidden" 
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                   <div className="rounded-lg bg-green-100 p-2 text-green-600">
                     <CheckCircleIcon className="h-5 w-5" />
                   </div>
                   <div>
                     <div className="text-sm font-medium text-slate-900">{file.name}</div>
                     <div className="text-xs text-slate-500">
                       {importSummary.total} rows | {importSummary.willImport} ready to import
                     </div>
                   </div>
                </div>
                <button 
                  onClick={resetImportState}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                {[
                  { label: "Total Rows", value: importSummary.total, tone: "text-slate-900 bg-white border-slate-200" },
                  { label: "Clean", value: importSummary.clean, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                  { label: "Flagged", value: importSummary.flagged, tone: "text-amber-800 bg-amber-50 border-amber-200" },
                  { label: "Will Import", value: importSummary.willImport, tone: "text-indigo-700 bg-indigo-50 border-indigo-200" },
                  { label: "Will Skip", value: importSummary.willSkip, tone: "text-rose-700 bg-rose-50 border-rose-200" },
                ].map((card) => (
                  <div key={card.label} className={`rounded-xl border px-4 py-3 ${card.tone}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide">{card.label}</div>
                    <div className="mt-2 text-2xl font-semibold">{card.value}</div>
                  </div>
                ))}
              </div>

              {(internalDuplicateKeys.length > 0 ||
                Object.values(externalDuplicates).some((matches) => matches.length > 0)) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="font-semibold">Potential duplicates detected</div>
                  <div className="mt-1">
                    Internal file duplicates: {internalDuplicateKeys.length}
                    {" | "}
                    Existing CRM matches: {Object.values(externalDuplicates).filter((matches) => matches.length > 0).length}
                  </div>
                  <label className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={skipPotentialDuplicates}
                      onChange={(e) => setSkipPotentialDuplicates(e.target.checked)}
                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    Skip flagged duplicate rows during import
                  </label>
                  <div className="mt-2 text-xs text-amber-700">
                    Review `Flagged only` below for the top CRM matches before importing.
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                Imported leads are added to your queue first. Use Assign/Reassign to distribute them to managers and BDAs.
              </div>

              {/* Preview Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Preview and duplicate review</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Showing {filteredPreviewRows.length} of {previewRows.length} rows.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "All rows" },
                      { id: "clean", label: "Clean only" },
                      { id: "flagged", label: "Flagged only" },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setDuplicateFilter(option.id as DuplicateFilter)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          duplicateFilter === option.id
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-semibold uppercase sticky top-0">
                      <tr>
                        <th className="px-4 py-2">Row</th>
                        <th className="px-4 py-2">ID (Auto)</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Email</th>
                        <th className="px-4 py-2">Phone</th>
                        <th className="px-4 py-2">Program</th>
                        <th className="px-4 py-2">Location</th>
                        <th className="px-4 py-2">Language</th>
                        <th className="px-4 py-2">Import</th>
                        <th className="px-4 py-2">Duplicates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewRows.map((l, i) => (
                        <tr key={`${l.previewKey}-${i}`} className={l.isFlagged ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-slate-50"}>
                          <td className="px-4 py-2 font-mono text-slate-500">{l.sourceRowNumber}</td>
                          <td className="px-4 py-2 font-mono text-slate-400">{l.leadId}</td>
                          <td className="px-4 py-2 font-medium text-slate-900">{l.name}</td>
                          <td className="px-4 py-2 text-slate-600">{l.email || "-"}</td>
                          <td className="px-4 py-2">{l.phone}</td>
                          <td className="px-4 py-2">{l.targetDegree}</td>
                          <td className="px-4 py-2">{l.leadLocation || "-"}</td>
                          <td className="px-4 py-2">{l.preferredLanguage || "-"}</td>
                          <td className="px-4 py-2">
                            <div className="space-y-1">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                l.willSkip
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}>
                                {l.willSkip ? "Skipped" : "Importing"}
                              </span>
                              <div className="text-[10px] text-slate-500">{l.status}</div>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            {l.isFlagged ? (
                              <div className="space-y-1">
                                {l.isInternalDuplicate ? (
                                  <div className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                    In file
                                  </div>
                                ) : null}
                                {l.externalMatches.length > 0 ? (
                                  <div className="space-y-1 text-[10px] text-amber-700">
                                    {l.externalMatches.slice(0, 2).map((candidate) => (
                                      <div key={`${l.previewKey}-${candidate.lead.leadId}`}>
                                        <span className="font-semibold">{candidate.lead.name}</span>
                                        {" | "}
                                        {candidate.reasons.join(", ")}
                                        {" | "}
                                        {candidate.lead.status}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">Clear</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewRows.length > filteredPreviewRows.length && (
                    <div className="p-2 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                      Narrow the filter to inspect additional rows.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
              <ExclamationCircleIcon className="h-5 w-5" />
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button 
              onClick={downloadTemplate}
              className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              <DocumentArrowDownIcon className="h-4 w-4" />
              Download Template
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            disabled={loading}
          >
            Cancel
          </button>
          <button 
            onClick={handleUpload}
            disabled={!canSubmitImport}
            className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Importing {progress}%
              </>
            ) : (
              `Import ${importSummary.willImport} Leads`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

