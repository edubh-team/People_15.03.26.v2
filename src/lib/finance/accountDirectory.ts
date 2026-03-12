import { getDisplayRole, isSuperAdminUser } from "@/lib/access";
import type {
  AccountPerson,
  FinanceAccountDirectoryItem,
  FinanceAccountDirectoryResponse,
} from "@/lib/types/finance";
import type { UserDoc } from "@/lib/types/user";

function compactValue(value?: string | null) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

export function normalizePhone(value: string) {
  return value.trim();
}

export function normalizeAccountNumber(value: string) {
  return compactValue(value);
}

export function normalizeIfscCode(value: string) {
  return compactValue(value).toUpperCase();
}

export function maskAccountNumber(value?: string | null) {
  const compact = compactValue(value);
  if (!compact) return null;
  if (compact.length <= 4) return compact;
  return `${"*".repeat(Math.max(compact.length - 4, 0))}${compact.slice(-4)}`;
}

export function maskIfscCode(value?: string | null) {
  const compact = compactValue(value).toUpperCase();
  if (!compact) return null;
  if (compact.length <= 6) return compact;
  return `${compact.slice(0, 4)}${"*".repeat(compact.length - 6)}${compact.slice(-2)}`;
}

function sortByName<T extends { name: string }>(items: T[]) {
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function toEmployeeFinanceAccount(user: UserDoc): FinanceAccountDirectoryItem | null {
  if (isSuperAdminUser(user)) return null;

  const accountNumber = user.kycDetails?.bankAccount ?? null;
  const ifscCode = user.kycDetails?.ifsc ?? null;

  return {
    id: user.uid,
    name: user.displayName || user.email || "Unknown",
    email: user.email || "",
    phone: user.phone || "",
    accountNumber,
    accountNumberMasked: maskAccountNumber(accountNumber),
    ifscCode,
    ifscCodeMasked: maskIfscCode(ifscCode),
    role: getDisplayRole(user),
    type: "EMPLOYEE",
    photoURL: user.photoURL ?? null,
    employeeId: user.employeeId ?? null,
    hasSensitiveData: Boolean(accountNumber || ifscCode),
  };
}

export function toExternalFinanceAccount(
  id: string,
  person: Partial<AccountPerson>,
): FinanceAccountDirectoryItem {
  const accountNumber = person.accountNumber ?? null;
  const ifscCode = person.ifscCode ?? null;

  return {
    id,
    name: person.name?.trim() || "Beneficiary",
    email: person.email?.trim() || "",
    phone: person.phone?.trim() || "",
    accountNumber,
    accountNumberMasked: maskAccountNumber(accountNumber),
    ifscCode,
    ifscCodeMasked: maskIfscCode(ifscCode),
    role: "Beneficiary",
    type: "EXTERNAL",
    photoURL: null,
    employeeId: null,
    hasSensitiveData: Boolean(accountNumber || ifscCode),
  };
}

export function buildFinanceAccountDirectory(params: {
  users: UserDoc[];
  externalAccounts: Array<{ id: string; data: Partial<AccountPerson> }>;
}): FinanceAccountDirectoryResponse {
  const employees = sortByName(
    params.users
      .map((user) => toEmployeeFinanceAccount(user))
      .filter((item): item is FinanceAccountDirectoryItem => Boolean(item)),
  );

  const externals = sortByName(
    params.externalAccounts.map(({ id, data }) => toExternalFinanceAccount(id, data)),
  );

  const items = [...employees, ...externals];

  return {
    items,
    summary: {
      total: items.length,
      employees: employees.length,
      external: externals.length,
      withSensitiveData: items.filter((item) => item.hasSensitiveData).length,
    },
  };
}
