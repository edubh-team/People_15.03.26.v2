import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { LeadDoc } from "@/lib/types/crm";
import { toTitleCase } from "@/lib/utils/stringUtils";

export type LeadDuplicateInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  targetUniversity?: string | null;
  targetDegree?: string | null;
};

export type LeadDuplicateCandidate = {
  lead: Pick<
    LeadDoc,
    "leadId" | "name" | "phone" | "email" | "status" | "targetUniversity" | "targetDegree"
  >;
  score: number;
  reasons: string[];
};

function chunkValues(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function normalizeLeadPhone(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits || null;
}

export function normalizeLeadEmail(email?: string | null) {
  const normalized = (email ?? "").trim().toLowerCase();
  return normalized || null;
}

export function normalizeLeadName(name?: string | null) {
  const normalized = (name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return normalized || null;
}

function normalizeLeadCandidate(docId: string, raw: Record<string, unknown>): LeadDoc {
  return {
    ...(raw as LeadDoc),
    leadId: docId,
  };
}

function scoreCandidate(candidate: LeadDoc, input: LeadDuplicateInput) {
  const reasons: string[] = [];
  let score = 0;

  const phone = normalizeLeadPhone(input.phone);
  const email = normalizeLeadEmail(input.email);
  const name = normalizeLeadName(input.name);
  const university = normalizeLeadName(input.targetUniversity);
  const degree = normalizeLeadName(input.targetDegree);

  if (phone && normalizeLeadPhone(candidate.phone) === phone) {
    reasons.push("Same phone number");
    score += 100;
  }

  if (email && normalizeLeadEmail(candidate.email) === email) {
    reasons.push("Same email address");
    score += 90;
  }

  if (name && normalizeLeadName(candidate.name) === name) {
    reasons.push("Same lead name");
    score += 40;
  }

  if (university && normalizeLeadName(candidate.targetUniversity) === university) {
    reasons.push("Same target university");
    score += 20;
  }

  if (degree && normalizeLeadName(candidate.targetDegree) === degree) {
    reasons.push("Same target degree");
    score += 15;
  }

  return { reasons, score };
}

export async function findLeadDuplicateCandidates(
  input: LeadDuplicateInput,
  options?: { excludeLeadId?: string | null },
): Promise<LeadDuplicateCandidate[]> {
  const results = await findBulkLeadDuplicateCandidates([
    {
      key: "single",
      ...input,
    },
  ]);

  return results.get("single") ?? [];
}

export async function findBulkLeadDuplicateCandidates(
  inputs: Array<LeadDuplicateInput & { key: string }>,
  options?: { excludeLeadIds?: string[] },
) {
  const output = new Map<string, LeadDuplicateCandidate[]>();
  if (!db || inputs.length === 0) return output;

  const existing = new Map<string, LeadDoc>();
  const leadsRef = collection(db, "leads");

  const phones = Array.from(
    new Set(inputs.map((input) => normalizeLeadPhone(input.phone)).filter(Boolean) as string[]),
  );
  const emails = Array.from(
    new Set(inputs.map((input) => normalizeLeadEmail(input.email)).filter(Boolean) as string[]),
  );
  const names = Array.from(
    new Set(
      inputs
        .map((input) => normalizeLeadName(input.name))
        .filter(Boolean)
        .map((value) => toTitleCase(value as string)) as string[],
    ),
  );

  const phoneQueries = chunkValues(phones, 10).map((chunk) =>
    getDocs(query(leadsRef, where("phone", "in", chunk), limit(50))),
  );
  const emailQueries = chunkValues(emails, 10).map((chunk) =>
    getDocs(query(leadsRef, where("email", "in", chunk), limit(50))),
  );
  const nameQueries = chunkValues(names, 10).map((chunk) =>
    getDocs(query(leadsRef, where("name", "in", chunk), limit(50))),
  );

  const snapshots = await Promise.all([...phoneQueries, ...emailQueries, ...nameQueries]);
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((leadDoc) => {
      existing.set(leadDoc.id, normalizeLeadCandidate(leadDoc.id, leadDoc.data()));
    });
  });

  const excluded = new Set((options?.excludeLeadIds ?? []).filter(Boolean));

  inputs.forEach((input) => {
    const matches = Array.from(existing.values())
      .filter((candidate) => !excluded.has(candidate.leadId))
      .map((candidate) => ({ candidate, ...scoreCandidate(candidate, input) }))
      .filter(({ score }) => score >= 40)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map(({ candidate, reasons, score }) => ({
        lead: {
          leadId: candidate.leadId,
          name: candidate.name,
          phone: candidate.phone,
          email: candidate.email,
          status: candidate.status,
          targetUniversity: candidate.targetUniversity,
          targetDegree: candidate.targetDegree,
        },
        reasons,
        score,
      }));

    output.set(input.key, matches);
  });

  return output;
}

export function summarizeDuplicateCandidates(candidates: LeadDuplicateCandidate[]) {
  if (candidates.length === 0) return null;
  return candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.lead.name} (${candidate.reasons.join(", ")})`)
    .join("; ");
}
