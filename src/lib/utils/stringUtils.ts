export function toTitleCase(str: string | null | undefined): string {
  if (!str) return "";
  return str.toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

export function generateLeadId(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(100000 + Math.random() * 900000); // 6 digit random
  return `LD-${year}${month}-${random}`;
}
