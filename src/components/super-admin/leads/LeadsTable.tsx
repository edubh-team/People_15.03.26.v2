import { LeadDoc } from "@/lib/types/crm";
import { format } from "date-fns";
import UserNameDisplay from "@/components/common/UserNameDisplay";

type Props = {
  data: LeadDoc[];
  type: "new" | "history";
};

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && "toDate" in ts && typeof (ts as { toDate: unknown }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (typeof ts === "object" && "seconds" in ts && typeof (ts as { seconds: unknown }).seconds === "number") {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  return new Date(ts as string | number);
}

export default function LeadsTable({ data, type }: Props) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        No leads found in this section.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {type === "new" ? (
                <th className="px-4 py-3 font-medium">Imported At</th>
              ) : (
                <th className="px-4 py-3 font-medium">Last Action</th>
              )}
              <th className="px-4 py-3 font-medium">Assigned To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((lead) => {
              const dateVal = type === "new" ? toDate(lead.createdAt) : toDate(lead.lastActionAt);
              
              return (
                <tr key={lead.leadId} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{lead.name}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      lead.status === "new" 
                        ? "bg-blue-50 text-blue-700"
                        : lead.status === "converted" || lead.status === "closed" || lead.status === "interested"
                        ? "bg-green-50 text-green-700"
                        : lead.status === "not_interested" || lead.status === "wrong_number" || lead.status === "cold" || lead.status === "notinterested" || lead.status === "wrongnumber"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-slate-100 text-slate-700"
                    }`}>
                      {lead.status ? (lead.status.charAt(0).toUpperCase() + lead.status.slice(1)) : "Unknown"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {dateVal ? format(dateVal, "MMM d, yyyy HH:mm") : "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <UserNameDisplay uid={lead.assignedTo} fallback={<span className="text-slate-400 italic">Unassigned</span>} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
