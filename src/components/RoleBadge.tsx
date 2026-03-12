import { formatRoleLabel } from "@/lib/access";
import { cn } from "@/lib/cn";

export function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    superadmin: "bg-purple-100 text-purple-700 ring-purple-600/20",
    admin: "bg-purple-50 text-purple-700 ring-purple-600/20",
    hr: "bg-pink-50 text-pink-700 ring-pink-600/20",
    manager: "bg-blue-50 text-blue-700 ring-blue-600/20",
    seniormanager: "bg-blue-50 text-blue-700 ring-blue-600/20",
    gm: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
    avp: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
    vp: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
    saleshead: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
    cbo: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20",
    ceo: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20",
    teamlead: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    employee: "bg-slate-50 text-slate-600 ring-slate-500/10",
    bda: "bg-slate-50 text-slate-600 ring-slate-500/10",
    financer: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  };
  
  const normalizedRole = (role || "employee").toLowerCase().replace(/[\s_-]/g, "");
  
  // Sort keys by length descending to ensure "superadmin" matches before "admin"
  const key = Object.keys(styles)
    .sort((a, b) => b.length - a.length)
    .find(k => normalizedRole.includes(k)) || "employee";
    
  const style = styles[key];

  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset uppercase", style)}>
      {formatRoleLabel(role)}
    </span>
  );
}
