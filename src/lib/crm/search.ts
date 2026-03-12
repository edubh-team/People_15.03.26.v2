import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { leadMatchesCrmScope } from "@/lib/crm/access";
import type { LeadDoc } from "@/lib/types/crm";
import { toTitleCase } from "@/lib/utils/stringUtils";

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function toLeadDoc(snapshot: QueryDocumentSnapshot | Awaited<ReturnType<typeof getDoc>>) {
  return { ...(snapshot.data() as LeadDoc), leadId: snapshot.id } as LeadDoc;
}

function prefixRange(value: string) {
  return [value, `${value}\uf8ff`] as const;
}

export async function searchCrmLeads(input: {
  firestore: Firestore;
  term: string;
  allowedOwnerUids?: string[] | null;
  limitPerQuery?: number;
  maxResults?: number;
}) {
  const {
    firestore,
    term,
    allowedOwnerUids = null,
    limitPerQuery = 8,
    maxResults = 20,
  } = input;

  const trimmed = term.trim();
  if (!trimmed) return [] as LeadDoc[];

  const lowerTerm = trimmed.toLowerCase();
  const titleTerm = toTitleCase(trimmed);
  const digitsTerm = trimmed.replace(/\D/g, "");
  const results = new Map<string, LeadDoc>();

  const docSnapshot = await getDoc(doc(firestore, "leads", trimmed));
  if (docSnapshot.exists()) {
    const lead = toLeadDoc(docSnapshot);
    if (leadMatchesCrmScope(lead, allowedOwnerUids)) {
      results.set(docSnapshot.id, lead);
    }
  }

  const searches: Array<Promise<QueryDocumentSnapshot[]>> = [];

  const [phoneStart, phoneEnd] = prefixRange(trimmed);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("phone", ">=", phoneStart),
        where("phone", "<=", phoneEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  if (digitsTerm) {
    const [normalizedPhoneStart, normalizedPhoneEnd] = prefixRange(digitsTerm);
    searches.push(
      getDocs(
        query(
          collection(firestore, "leads"),
          where("normalizedPhone", ">=", normalizedPhoneStart),
          where("normalizedPhone", "<=", normalizedPhoneEnd),
          limit(limitPerQuery),
        ),
      ).then((snapshot) => snapshot.docs),
    );
  }

  const [emailStart, emailEnd] = prefixRange(trimmed);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("email", ">=", emailStart),
        where("email", "<=", emailEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const [normalizedEmailStart, normalizedEmailEnd] = prefixRange(lowerTerm);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("normalizedEmail", ">=", normalizedEmailStart),
        where("normalizedEmail", "<=", normalizedEmailEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const [rawNameStart, rawNameEnd] = prefixRange(trimmed);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("name", ">=", rawNameStart),
        where("name", "<=", rawNameEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  if (titleTerm !== trimmed) {
    const [titleNameStart, titleNameEnd] = prefixRange(titleTerm);
    searches.push(
      getDocs(
        query(
          collection(firestore, "leads"),
          where("name", ">=", titleNameStart),
          where("name", "<=", titleNameEnd),
          limit(limitPerQuery),
        ),
      ).then((snapshot) => snapshot.docs),
    );
  }

  const [normalizedNameStart, normalizedNameEnd] = prefixRange(lowerTerm);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("normalizedName", ">=", normalizedNameStart),
        where("normalizedName", "<=", normalizedNameEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const [sourceStart, sourceEnd] = prefixRange(trimmed);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("source", ">=", sourceStart),
        where("source", "<=", sourceEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const [sourceNormalizedStart, sourceNormalizedEnd] = prefixRange(lowerTerm);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("sourceNormalized", ">=", sourceNormalizedStart),
        where("sourceNormalized", "<=", sourceNormalizedEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const [campaignStart, campaignEnd] = prefixRange(trimmed);
  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("campaignName", ">=", campaignStart),
        where("campaignName", "<=", campaignEnd),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("importTagsNormalized", "array-contains", lowerTerm),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  searches.push(
    getDocs(
      query(
        collection(firestore, "leads"),
        where("leadTagsNormalized", "array-contains", lowerTerm),
        limit(limitPerQuery),
      ),
    ).then((snapshot) => snapshot.docs),
  );

  const snapshots = await Promise.all(searches);
  snapshots.flat().forEach((snapshot) => {
    const lead = toLeadDoc(snapshot);
    if (leadMatchesCrmScope(lead, allowedOwnerUids)) {
      results.set(snapshot.id, lead);
    }
  });

  return Array.from(results.values())
    .sort(
      (left, right) =>
        toMillis(right.updatedAt ?? right.createdAt) -
        toMillis(left.updatedAt ?? left.createdAt),
    )
    .slice(0, maxResults);
}
