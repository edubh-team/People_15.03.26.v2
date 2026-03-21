"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { formatRoleLabel, getPrimaryRole } from "@/lib/access";
import { getRoleKnowledgeGuide } from "@/lib/knowledge-center/content";
import {
  clearGuidedTourCompletion,
  GUIDED_TOUR_FORCE_START_KEY,
} from "@/lib/knowledge-center/state";
import { getHomeRoute } from "@/lib/utils/routing";

function resolveKnowledgeRouteHref(route?: string | null, userUid?: string | null) {
  if (!route) return null;
  if (!route.includes("[")) return route;

  if (route === "/profile/[uid]") {
    return userUid ? `/profile/${userUid}` : "/profile";
  }

  if (route === "/reports/[employeeId]") {
    return "/reports";
  }

  return null;
}

export default function KnowledgeCenterPage() {
  const { userDoc } = useAuth();
  const router = useRouter();
  const role = useMemo(() => getPrimaryRole(userDoc), [userDoc]);
  const guide = useMemo(() => getRoleKnowledgeGuide(role), [role]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const roleLabel = formatRoleLabel(userDoc?.orgRole ?? userDoc?.role ?? role);
  const filteredModuleCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return guide.moduleCatalog;
    return guide.moduleCatalog.filter((row) =>
      [
        row.title,
        row.group,
        row.summary,
        ...row.features,
        ...row.actions,
        ...row.entities,
        row.route ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [catalogQuery, guide.moduleCatalog]);
  const groupedModuleCatalog = useMemo(() => {
    const map = new Map<string, typeof filteredModuleCatalog>();
    filteredModuleCatalog.forEach((row) => {
      const current = map.get(row.group) ?? [];
      map.set(row.group, [...current, row]);
    });
    return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredModuleCatalog]);
  const moduleCatalogStats = useMemo(() => {
    return filteredModuleCatalog.reduce(
      (acc, row) => {
        acc.features += row.features.length;
        acc.actions += row.actions.length;
        acc.entities += row.entities.length;
        if (row.permissions?.length) acc.permissionPoints += row.permissions.length;
        if (row.handoffs?.length) acc.handoffs += row.handoffs.length;
        return acc;
      },
      { features: 0, actions: 0, entities: 0, permissionPoints: 0, handoffs: 0 },
    );
  }, [filteredModuleCatalog]);

  const toGroupAnchor = (group: string) => `group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const startTour = () => {
    clearGuidedTourCompletion(role);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUIDED_TOUR_FORCE_START_KEY, "1");
    }
    router.push(getHomeRoute(userDoc?.role, userDoc?.orgRole));
  };

  return (
    <AuthGate>
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Knowledge Center
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">{guide.title}</h1>
              <p className="mt-2 text-sm text-slate-600">{guide.intro}</p>
              <p className="mt-3 text-xs text-slate-500">
                Current role: <span className="font-semibold text-slate-700">{roleLabel}</span>
              </p>
              <div className="mt-2 inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Role-scoped view only. You cannot view other role knowledge centers.
              </div>
            </div>
            <button
              type="button"
              onClick={startTour}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Start guided tour
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Guided Tour Outline</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {guide.tourSteps.map((step, index) => (
              <article key={step.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Step {index + 1}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{step.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{step.description}</p>
                {resolveKnowledgeRouteHref(step.route, userDoc?.uid) ? (
                  <Link
                    href={resolveKnowledgeRouteHref(step.route, userDoc?.uid)!}
                    className="mt-2 inline-flex rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Open page
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Role SOP Modules</h2>
          <div className="mt-4 space-y-4">
            {guide.modules.map((module) => (
              <article key={module.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{module.title}</div>
                    <p className="mt-1 text-xs text-slate-600">{module.description}</p>
                  </div>
                  {resolveKnowledgeRouteHref(module.route, userDoc?.uid) ? (
                    <Link
                      href={resolveKnowledgeRouteHref(module.route, userDoc?.uid)!}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Open module
                    </Link>
                  ) : null}
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                  {module.sop.map((item, index) => (
                    <li key={`${module.id}-sop-${index}`}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">System Module Catalog</h2>
              <p className="mt-1 text-xs text-slate-500">
                Complete role-scoped module inventory. Only modules for your role are shown.
              </p>
            </div>
            <div className="w-full max-w-sm">
              <input
                type="text"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder="Search module, feature, action, entity..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Modules</div>
              <div className="text-base font-semibold text-slate-900">{filteredModuleCatalog.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Feature Points</div>
              <div className="text-base font-semibold text-slate-900">{moduleCatalogStats.features}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Action Points</div>
              <div className="text-base font-semibold text-slate-900">{moduleCatalogStats.actions}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Entities</div>
              <div className="text-base font-semibold text-slate-900">{moduleCatalogStats.entities}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Permissions</div>
              <div className="text-base font-semibold text-slate-900">{moduleCatalogStats.permissionPoints}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Handoffs</div>
              <div className="text-base font-semibold text-slate-900">{moduleCatalogStats.handoffs}</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Group jump:
            <span className="ml-2 inline-flex flex-wrap gap-2 align-middle">
              {groupedModuleCatalog.map(([group]) => (
                <a
                  key={`catalog-jump-${group}`}
                  href={`#${toGroupAnchor(group)}`}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {group}
                </a>
              ))}
            </span>
          </div>

          <div className="mt-4 space-y-4">
            {groupedModuleCatalog.map(([group, rows]) => (
              <div key={`catalog-group-${group}`} id={toGroupAnchor(group)} className="space-y-3 scroll-mt-24">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {rows.map((row) => (
                    <article key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900">{row.title}</div>
                            {row.surface ? (
                              <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                {row.surface}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-600">{row.summary}</p>
                        </div>
                        {resolveKnowledgeRouteHref(row.route, userDoc?.uid) ? (
                          <Link
                            href={resolveKnowledgeRouteHref(row.route, userDoc?.uid)!}
                            className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            Open module
                          </Link>
                        ) : null}
                      </div>

                      <div className="mt-3 grid gap-3 text-xs text-slate-700">
                        <div>
                          <div className="font-semibold text-slate-900">Features</div>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {row.features.map((feature, index) => (
                              <li key={`${row.id}-feature-${index}`}>{feature}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">Actions</div>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {row.actions.map((action, index) => (
                              <li key={`${row.id}-action-${index}`}>{action}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">Data Entities</div>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {row.entities.map((entity, index) => (
                              <li key={`${row.id}-entity-${index}`}>{entity}</li>
                            ))}
                          </ul>
                        </div>
                        {row.permissions?.length ? (
                          <div>
                            <div className="font-semibold text-slate-900">Permissions</div>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {row.permissions.map((permission, index) => (
                                <li key={`${row.id}-permission-${index}`}>{permission}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {row.handoffs?.length ? (
                          <div>
                            <div className="font-semibold text-slate-900">Handoffs</div>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {row.handoffs.map((handoff, index) => (
                                <li key={`${row.id}-handoff-${index}`}>{handoff}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
            {groupedModuleCatalog.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No modules match the current search. Clear the search query to view the full role-scoped catalog.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Role Workflows</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {guide.workflows.map((workflow) => (
              <article key={workflow.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{workflow.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Trigger: <span className="font-medium text-slate-700">{workflow.trigger}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Outcome: <span className="font-medium text-slate-700">{workflow.outcome}</span>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                  {workflow.steps.map((step, index) => (
                    <li key={`${workflow.id}-step-${index}`}>{step}</li>
                  ))}
                </ul>
                {resolveKnowledgeRouteHref(workflow.route, userDoc?.uid) ? (
                  <Link
                    href={resolveKnowledgeRouteHref(workflow.route, userDoc?.uid)!}
                    className="mt-3 inline-flex rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Open workflow page
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Operating Rhythm</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Daily</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                {guide.operatingRhythm.daily.map((item, index) => (
                  <li key={`daily-${index}`}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                {guide.operatingRhythm.weekly.map((item, index) => (
                  <li key={`weekly-${index}`}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bi-Weekly</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                {guide.operatingRhythm.biWeekly.map((item, index) => (
                  <li key={`bi-weekly-${index}`}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Shortcuts and Alerts</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keyboard Shortcuts</div>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-700">
                {guide.shortcuts.map((shortcut, index) => (
                  <li key={`shortcut-${index}`}>
                    <span className="font-semibold text-slate-900">{shortcut.keys}</span> - {shortcut.action}
                  </li>
                ))}
              </ul>
            </article>
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Critical Alerts</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                {guide.alerts.map((alert, index) => (
                  <li key={`alert-${index}`}>{alert}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Troubleshooting and FAQs</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="space-y-3">
              {guide.troubleshooting.map((item, index) => (
                <div key={`troubleshooting-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">{item.issue}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                    {item.checks.map((check, checkIndex) => (
                      <li key={`troubleshooting-${index}-check-${checkIndex}`}>{check}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
            <article className="space-y-3">
              {guide.faqs.map((item, index) => (
                <div key={`faq-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">{item.question}</div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{item.answer}</p>
                </div>
              ))}
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Glossary</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {guide.glossary.map((item, index) => (
              <article key={`glossary-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{item.term}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.meaning}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AuthGate>
  );
}
