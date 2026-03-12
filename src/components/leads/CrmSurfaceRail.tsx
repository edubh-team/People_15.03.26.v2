"use client";

import Link from "next/link";

export type CrmSurfaceMode = "workbench" | "new" | "worked" | "inspector";

type Props = {
  activeSurface: CrmSurfaceMode;
  showInspector?: boolean;
};

const BASE_STYLES =
  "rounded-full border px-3 py-2 text-xs font-semibold transition";

function getHref(surface: CrmSurfaceMode) {
  if (surface === "workbench") return "/crm/leads?surface=workbench";
  if (surface === "new") return "/crm/leads?surface=new&layout=compact";
  if (surface === "worked") return "/crm/leads?surface=worked&layout=compact";
  return `/crm/leads?surface=${surface}`;
}

export function CrmSurfaceRail({ activeSurface, showInspector = false }: Props) {
  const items: Array<{ id: CrmSurfaceMode; label: string }> = [
    { id: "workbench", label: "Modern Workbench" },
    { id: "new", label: "Fresh Queue" },
    { id: "worked", label: "Worked Queue" },
  ];

  if (showInspector) {
    items.push({ id: "inspector", label: "Inspector" });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        CRM Surfaces
      </div>
      {items.map((item) => {
        const isActive = item.id === activeSurface;
        return (
          <Link
            key={item.id}
            href={getHref(item.id)}
            className={`${BASE_STYLES} ${
              isActive
                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <div className="ml-auto text-[11px] text-slate-500">
        Legacy routes stay available until these surfaces fully replace them.
      </div>
    </div>
  );
}
