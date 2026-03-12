import { read, utils } from "@e965/xlsx";
import { 
  doc, 
  writeBatch, 
  serverTimestamp, 
  getFirestore 
} from "firebase/firestore";
import { toTitleCase, generateLeadId } from "@/lib/utils/stringUtils";

export type ImportResult = {
  total: number;
  success: number;
  failed: number;
  errors: string[];
};

export type ExcelRow = {
  Name?: string;
  "Phone Number"?: string | number;
  Phone?: string | number;
  Email?: string;
  City?: string;
  [key: string]: unknown;
};

// Helper to validate phone number (10 digits)
function validatePhone(phone: unknown): string | null {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, "");
  return cleaned.length === 10 ? cleaned : null;
}

// Helper to strip whitespace
function sanitizeString(str: unknown): string {
  if (typeof str !== "string") return "";
  return str.trim();
}

export async function processLeadImport(
  file: File, 
  onProgress?: (processed: number, total: number) => void
): Promise<ImportResult> {
  const db = getFirestore();
  const errors: string[] = [];
  let successCount = 0;
  let failCount = 0;

  try {
    // 1. Parse Excel File
    const buffer = await file.arrayBuffer();
    const workbook = read(buffer);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json<ExcelRow>(sheet);

    if (!rows.length) {
      return { total: 0, success: 0, failed: 0, errors: ["File is empty"] };
    }

    const totalRows = rows.length;
    const batches = [];
    let currentBatch = writeBatch(db);
    let operationCount = 0;

    // 2. Transform and Batch
    for (let i = 0; i < totalRows; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-based, +1 header)

      // Column Mapping & Sanitization
      const name = toTitleCase(sanitizeString(row.Name || row["Full Name"] || row["Lead Name"]));
      // Check multiple possible phone column names
      const rawPhone = row["Phone Number"] || row.Phone || row.Mobile || row["Mobile Number"];
      const phone = validatePhone(rawPhone);
      const email = sanitizeString(row.Email || row["Email Address"]);
      const city = sanitizeString(row.City || row.Location);

      // Validation
      if (!name) {
        errors.push(`Row ${rowNum}: Missing Name`);
        failCount++;
        continue;
      }
      if (!phone) {
        errors.push(`Row ${rowNum}: Invalid Phone Number (${rawPhone || "Missing"})`);
        failCount++;
        continue;
      }

      // Construct Lead Document (Force New Logic)
      const leadId = generateLeadId();
      const newLeadRef = doc(db, "leads", leadId);
      const leadData = {
        leadId: leadId,
        name,
        phone,
        email: email || null,
        city: city || null, // Assuming schema allows city or put in remarks/address
        
        // Critical Business Rule: Force "new" status
        status: "new",
        subStatus: "NA",
        source: "Bulk Import",
        importedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isActive: true,
        history: [], // Initialize empty history
        activityHistory: [], // Initialize empty activity history
        
        // Default fields to match LeadDoc if needed
        remarks: "",
        assignedTo: null,
        ownerUid: null,
        kycData: {
            aadhar: null,
            pan: null,
            address: city || null,
            parentDetails: null
        }
      };

      currentBatch.set(newLeadRef, leadData);
      successCount++;
      operationCount++;

      // Firestore Batch Limit is 500
      if (operationCount >= 500) {
        batches.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        operationCount = 0;
      }
      
      // Update progress every 50 rows or at end
      if (onProgress && (i % 50 === 0 || i === totalRows - 1)) {
        onProgress(i + 1, totalRows);
      }
    }

    // Commit final batch if has operations
    if (operationCount > 0) {
      batches.push(currentBatch.commit());
    }

    // Wait for all batches
    await Promise.all(batches);

    return {
      total: totalRows,
      success: successCount,
      failed: failCount,
      errors
    };

  } catch (err) {
    console.error("Import error:", err);
    return {
      total: 0,
      success: successCount,
      failed: failCount,
      errors: [...errors, err instanceof Error ? err.message : "Unknown error"]
    };
  }
}
