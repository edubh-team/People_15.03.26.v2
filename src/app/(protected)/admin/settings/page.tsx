"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { db, isFirebaseReady } from "@/lib/firebase/client";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";
import {
  ShieldCheckIcon,
  AdjustmentsHorizontalIcon,
  GlobeAltIcon,
} from "@heroicons/react/24/outline";

type AccessRule = "strict" | "balanced" | "open";
type SecurityLevel = "standard" | "high";
type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
type TimeFormat = "12h" | "24h";
type LanguageCode = "en" | "hi" | "en-IN";
type ThemePreference = "light" | "dark" | "system";

type SystemPolicies = {
  accessRule: AccessRule;
  securityLevel: SecurityLevel;
  dataRetentionDays: number;
  allowExternalAccess: boolean;
};

type ApplicationDefaults = {
  defaultUserRole:
    | "employee"
    | "manager"
    | "teamLead"
    | "bdaTrainee"
    | "bdmTraining";
  defaultWorkspace: "HR" | "CRM" | "mixed";
};

type ApplicationPreferences = {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  language: LanguageCode;
  theme: ThemePreference;
  notifyEmail: boolean;
  notifyInApp: boolean;
};

type AdminSettings = {
  systemPolicies: SystemPolicies;
  applicationDefaults: ApplicationDefaults;
  applicationPreferences: ApplicationPreferences;
  updatedAt?: unknown;
};

type SectionId = "systemPolicies" | "applicationDefaults" | "applicationPreferences";

const defaultSettings: AdminSettings = {
  systemPolicies: {
    accessRule: "balanced",
    securityLevel: "standard",
    dataRetentionDays: 365,
    allowExternalAccess: false,
  },
  applicationDefaults: {
    defaultUserRole: "employee",
    defaultWorkspace: "HR",
  },
  applicationPreferences: {
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    language: "en-IN",
    theme: "system",
    notifyEmail: true,
    notifyInApp: true,
  },
};

const sectionOrder: SectionId[] = [
  "systemPolicies",
  "applicationDefaults",
  "applicationPreferences",
];

export default function AdminSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<AdminSettings | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("systemPolicies");
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<SectionId | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<SectionId, string>>>({});
  const [sectionSuccess, setSectionSuccess] = useState<Partial<Record<SectionId, string>>>({});
  const [dirty, setDirty] = useState<Record<SectionId, boolean>>({
    systemPolicies: false,
    applicationDefaults: false,
    applicationPreferences: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("adminSettingsActiveSection");
    if (stored === "systemPolicies" || stored === "applicationDefaults" || stored === "applicationPreferences") {
      setActiveSection(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("adminSettingsActiveSection", activeSection);
  }, [activeSection]);

  useEffect(() => {
    if (!db || !isFirebaseReady) {
      setSettings(defaultSettings);
      setInitialSettings(defaultSettings);
      setLoading(false);
      return;
    }

    const run = async () => {
      if (!db) return;
      try {
        const ref = doc(db, "systemConfig", "global");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as Partial<AdminSettings>;
          const merged: AdminSettings = {
            systemPolicies: {
              ...defaultSettings.systemPolicies,
              ...(data.systemPolicies ?? {}),
            },
            applicationDefaults: {
              ...defaultSettings.applicationDefaults,
              ...(data.applicationDefaults ?? {}),
            },
            applicationPreferences: {
              ...defaultSettings.applicationPreferences,
              ...(data.applicationPreferences ?? {}),
            },
            updatedAt: data.updatedAt,
          };
          setSettings(merged);
          setInitialSettings(merged);
        } else {
          const withTimestamp: AdminSettings = {
            ...defaultSettings,
            updatedAt: serverTimestamp(),
          };
          await setDoc(ref, withTimestamp);
          setSettings(withTimestamp);
          setInitialSettings(withTimestamp);
        }
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!Object.values(dirty).some(Boolean)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const hasDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty]);

  const updateSettings = (updater: (prev: AdminSettings) => AdminSettings, section: SectionId) => {
    setSettings(prev => {
      if (!prev) return prev;
      const next = updater(prev);
      return next;
    });
    setDirty(prev => ({ ...prev, [section]: true }));
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    setSectionSuccess(prev => ({ ...prev, [section]: undefined }));
  };

  const resetSection = (section: SectionId) => {
    if (!settings || !initialSettings) return;
    if (section === "systemPolicies") {
      setSettings(prev => prev ? { ...prev, systemPolicies: initialSettings.systemPolicies } : prev);
    } else if (section === "applicationDefaults") {
      setSettings(prev => prev ? { ...prev, applicationDefaults: initialSettings.applicationDefaults } : prev);
    } else {
      setSettings(prev => prev ? { ...prev, applicationPreferences: initialSettings.applicationPreferences } : prev);
    }
    setDirty(prev => ({ ...prev, [section]: false }));
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    setSectionSuccess(prev => ({ ...prev, [section]: undefined }));
  };

  const resetSectionToDefaults = (section: SectionId) => {
    if (!settings) return;
    if (section === "systemPolicies") {
      setSettings(prev => prev ? { ...prev, systemPolicies: defaultSettings.systemPolicies } : prev);
    } else if (section === "applicationDefaults") {
      setSettings(prev => prev ? { ...prev, applicationDefaults: defaultSettings.applicationDefaults } : prev);
    } else {
      setSettings(prev => prev ? { ...prev, applicationPreferences: defaultSettings.applicationPreferences } : prev);
    }
    setDirty(prev => ({ ...prev, [section]: true }));
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    setSectionSuccess(prev => ({ ...prev, [section]: undefined }));
  };

  const validateSection = (section: SectionId, current: AdminSettings) => {
    if (section === "systemPolicies") {
      if (!current.systemPolicies.dataRetentionDays || current.systemPolicies.dataRetentionDays < 1) {
        return "Data retention must be at least 1 day.";
      }
      if (current.systemPolicies.dataRetentionDays > 3650) {
        return "Data retention cannot exceed 10 years.";
      }
      return null;
    }
    if (section === "applicationDefaults") {
      if (!current.applicationDefaults.defaultUserRole) {
        return "Default user role is required.";
      }
      if (!current.applicationDefaults.defaultWorkspace) {
        return "Default workspace is required.";
      }
      return null;
    }
    if (!current.applicationPreferences.language) {
      return "Language is required.";
    }
    return null;
  };

  const saveSection = async (section: SectionId) => {
    if (!settings || !db || !isFirebaseReady) return;
    const error = validateSection(section, settings);
    if (error) {
      setSectionErrors(prev => ({ ...prev, [section]: error }));
      setSectionSuccess(prev => ({ ...prev, [section]: undefined }));
      return;
    }

    setSavingSection(section);
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    setSectionSuccess(prev => ({ ...prev, [section]: undefined }));

    try {
      const ref = doc(db, "systemConfig", "global");
      let payload: Partial<AdminSettings> = {};
      if (section === "systemPolicies") {
        payload = { systemPolicies: settings.systemPolicies };
      } else if (section === "applicationDefaults") {
        payload = { applicationDefaults: settings.applicationDefaults };
      } else {
        payload = { applicationPreferences: settings.applicationPreferences };
      }

      await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      setSectionSuccess(prev => ({ ...prev, [section]: "Changes saved." }));
      setDirty(prev => ({ ...prev, [section]: false }));
      setInitialSettings(prev => {
        if (!prev) return prev;
        if (section === "systemPolicies") {
          return { ...prev, systemPolicies: settings.systemPolicies };
        }
        if (section === "applicationDefaults") {
          return { ...prev, applicationDefaults: settings.applicationDefaults };
        }
        return { ...prev, applicationPreferences: settings.applicationPreferences };
      });
    } catch (error: unknown) {
      const message = (error as { message?: string })?.message ?? "Failed to save changes.";
      setSectionErrors(prev => ({ ...prev, [section]: message }));
      setSectionSuccess(prev => ({ ...prev, [section]: undefined }));
    } finally {
      setSavingSection(prev => (prev === section ? null : prev));
    }
  };

  const systemPoliciesDisabled = !settings || loading;
  const appDefaultsDisabled = !settings || loading;
  const preferencesDisabled = !settings || loading;

  const sectionTitle = (section: SectionId) => {
    if (section === "systemPolicies") return "System Policies";
    if (section === "applicationDefaults") return "Application Defaults";
    return "Application Preferences";
  };

  const sectionDescription = (section: SectionId) => {
    if (section === "systemPolicies") {
      return "Control access rules, security posture, and retention across the organization.";
    }
    if (section === "applicationDefaults") {
      return "Define how new users and workspaces are initialized by default.";
    }
    return "Configure global UX, locale, and notification behaviour for the app.";
  };

  const renderSection = () => {
    if (!settings) return null;

    if (activeSection === "systemPolicies") {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">System Policies</h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure access, security posture, and retention for all users.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="accessRule">
                Access model
              </label>
              <select
                id="accessRule"
                disabled={systemPoliciesDisabled}
                value={settings.systemPolicies.accessRule}
                onChange={(e) =>
                  updateSettings(
                    (prev) => ({
                      ...prev,
                      systemPolicies: { ...prev.systemPolicies, accessRule: e.target.value as AccessRule },
                    }),
                    "systemPolicies",
                  )
                }
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="strict">Strict (least privilege)</option>
                <option value="balanced">Balanced</option>
                <option value="open">Open (broad access)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="securityLevel">
                Security level
              </label>
              <select
                id="securityLevel"
                disabled={systemPoliciesDisabled}
                value={settings.systemPolicies.securityLevel}
                onChange={(e) =>
                  updateSettings(
                    (prev) => ({
                      ...prev,
                      systemPolicies: {
                        ...prev.systemPolicies,
                        securityLevel: e.target.value as SecurityLevel,
                      },
                    }),
                    "systemPolicies",
                  )
                }
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="standard">Standard</option>
                <option value="high">High (recommended)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="retentionDays">
                Data retention (days)
              </label>
              <input
                id="retentionDays"
                type="number"
                min={1}
                max={3650}
                disabled={systemPoliciesDisabled}
                value={settings.systemPolicies.dataRetentionDays}
                onChange={(e) =>
                  updateSettings(
                    (prev) => ({
                      ...prev,
                      systemPolicies: {
                        ...prev.systemPolicies,
                        dataRetentionDays: Number(e.target.value || 0),
                      },
                    }),
                    "systemPolicies",
                  )
                }
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <p className="text-xs text-slate-500">
                Controls how long audit and activity data is retained before archival.
              </p>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">External access</span>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  disabled={systemPoliciesDisabled}
                  onClick={() =>
                    updateSettings(
                      (prev) => ({
                        ...prev,
                        systemPolicies: {
                          ...prev.systemPolicies,
                          allowExternalAccess: !prev.systemPolicies.allowExternalAccess,
                        },
                      }),
                      "systemPolicies",
                    )
                  }
                  aria-pressed={settings.systemPolicies.allowExternalAccess}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    settings.systemPolicies.allowExternalAccess
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                      : "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      settings.systemPolicies.allowExternalAccess ? "bg-emerald-500" : "bg-slate-400"
                    }`}
                  />
                  {settings.systemPolicies.allowExternalAccess ? "Enabled" : "Disabled"}
                </button>
                <p className="text-xs text-slate-500">
                  Toggle to allow access from external partner accounts.
                </p>
              </div>
            </div>
          </div>
          <SectionFooter
            section="systemPolicies"
            dirty={dirty.systemPolicies}
            saving={savingSection === "systemPolicies"}
            error={sectionErrors.systemPolicies}
            success={sectionSuccess.systemPolicies}
            onSave={() => saveSection("systemPolicies")}
            onCancel={() => resetSection("systemPolicies")}
            onResetDefaults={() => resetSectionToDefaults("systemPolicies")}
          />
        </div>
      );
    }

    if (activeSection === "applicationDefaults") {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Application Defaults</h2>
            <p className="mt-1 text-sm text-slate-500">
              Define how new users and workspaces are created by default.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="defaultUserRole">
                Default user role
              </label>
              <select
                id="defaultUserRole"
                disabled={appDefaultsDisabled}
                value={settings.applicationDefaults.defaultUserRole}
                onChange={(e) =>
                  updateSettings(
                    (prev) => ({
                      ...prev,
                      applicationDefaults: {
                        ...prev.applicationDefaults,
                        defaultUserRole: e.target.value as ApplicationDefaults["defaultUserRole"],
                      },
                    }),
                    "applicationDefaults",
                  )
                }
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="employee">Employee</option>
                <option value="bdaTrainee">BDA (Trainee)</option>
                <option value="teamLead">Team Lead</option>
                <option value="manager">Manager</option>
                <option value="bdmTraining">BDM (Training)</option>
              </select>
              <p className="text-xs text-slate-500">
                Applies when new accounts are created without an explicit role.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="defaultWorkspace">
                Default workspace
              </label>
              <select
                id="defaultWorkspace"
                disabled={appDefaultsDisabled}
                value={settings.applicationDefaults.defaultWorkspace}
                onChange={(e) =>
                  updateSettings(
                    (prev) => ({
                      ...prev,
                      applicationDefaults: {
                        ...prev.applicationDefaults,
                        defaultWorkspace: e.target.value as ApplicationDefaults["defaultWorkspace"],
                      },
                    }),
                    "applicationDefaults",
                  )
                }
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="HR">HR</option>
                <option value="CRM">CRM</option>
                <option value="mixed">Mixed</option>
              </select>
              <p className="text-xs text-slate-500">
                Controls which workspace users land in on first sign-in.
              </p>
            </div>
          </div>
          <SectionFooter
            section="applicationDefaults"
            dirty={dirty.applicationDefaults}
            saving={savingSection === "applicationDefaults"}
            error={sectionErrors.applicationDefaults}
            success={sectionSuccess.applicationDefaults}
            onSave={() => saveSection("applicationDefaults")}
            onCancel={() => resetSection("applicationDefaults")}
            onResetDefaults={() => resetSectionToDefaults("applicationDefaults")}
          />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Application Preferences</h2>
          <p className="mt-1 text-sm text-slate-500">
            Configure locale, time, and notification defaults for the workspace.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="dateFormat">
              Date format
            </label>
            <select
              id="dateFormat"
              disabled={preferencesDisabled}
              value={settings.applicationPreferences.dateFormat}
              onChange={(e) =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      dateFormat: e.target.value as DateFormat,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="timeFormat">
              Time format
            </label>
            <select
              id="timeFormat"
              disabled={preferencesDisabled}
              value={settings.applicationPreferences.timeFormat}
              onChange={(e) =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      timeFormat: e.target.value as TimeFormat,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <option value="24h">24-hour</option>
              <option value="12h">12-hour</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              disabled={preferencesDisabled}
              value={settings.applicationPreferences.language}
              onChange={(e) =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      language: e.target.value as LanguageCode,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <option value="en-IN">English (India)</option>
              <option value="en">English (US)</option>
              <option value="hi">Hindi</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="theme">
              Theme
            </label>
            <select
              id="theme"
              disabled={preferencesDisabled}
              value={settings.applicationPreferences.theme}
              onChange={(e) =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      theme: e.target.value as ThemePreference,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <option value="system">System default</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
        <div className="space-y-3">
          <span className="text-sm font-medium text-slate-700">Notification defaults</span>
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              disabled={preferencesDisabled}
              onClick={() =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      notifyEmail: !prev.applicationPreferences.notifyEmail,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              aria-pressed={settings.applicationPreferences.notifyEmail}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition-all ${
                settings.applicationPreferences.notifyEmail
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
              }`}
            >
              <div>
                <div className="font-medium">Email notifications</div>
                <div className="mt-1 text-xs text-slate-500">
                  Send important alerts to the user&apos;s registered email.
                </div>
              </div>
              <span
                className={`ml-3 inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                  settings.applicationPreferences.notifyEmail ? "bg-emerald-500" : "bg-slate-300"
                }`}
                aria-hidden="true"
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.applicationPreferences.notifyEmail ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
            <button
              type="button"
              disabled={preferencesDisabled}
              onClick={() =>
                updateSettings(
                  (prev) => ({
                    ...prev,
                    applicationPreferences: {
                      ...prev.applicationPreferences,
                      notifyInApp: !prev.applicationPreferences.notifyInApp,
                    },
                  }),
                  "applicationPreferences",
                )
              }
              aria-pressed={settings.applicationPreferences.notifyInApp}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition-all ${
                settings.applicationPreferences.notifyInApp
                  ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                  : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
              }`}
            >
              <div>
                <div className="font-medium">In-app notifications</div>
                <div className="mt-1 text-xs text-slate-500">
                  Show alerts in the notification center and activity feed.
                </div>
              </div>
              <span
                className={`ml-3 inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                  settings.applicationPreferences.notifyInApp ? "bg-indigo-500" : "bg-slate-300"
                }`}
                aria-hidden="true"
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.applicationPreferences.notifyInApp ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
        <SectionFooter
          section="applicationPreferences"
          dirty={dirty.applicationPreferences}
          saving={savingSection === "applicationPreferences"}
          error={sectionErrors.applicationPreferences}
          success={sectionSuccess.applicationPreferences}
          onSave={() => saveSection("applicationPreferences")}
          onCancel={() => resetSection("applicationPreferences")}
          onResetDefaults={() => resetSectionToDefaults("applicationPreferences")}
        />
      </div>
    );
  };

  const statusText = hasDirty ? "Unsaved changes" : "All changes saved";
  const statusTone = hasDirty ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";

  return (
    <AuthGate allowedRoles={["admin"]}>
      <main className="min-h-screen bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="w-full max-w-full shrink-0 space-y-4 lg:w-64">
              <div className="relative overflow-hidden rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-200 lg:p-5">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100" />
                <div className="relative flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => router.push("/admin")}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-xs hover:border-slate-300 hover:text-slate-900"
                  >
                    <span className="inline-block h-3 w-3 -translate-y-px rotate-180 border-b border-l border-slate-500" />
                    Back to Admin
                  </button>
                  <span className="hidden rounded-full bg-slate-900/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-50 shadow-sm sm:inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Secure Area
                  </span>
                </div>
                <div className="relative mt-4 space-y-1">
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-50 px-3 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Admin Portal
                  </div>
                  <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-2xl">
                    Admin Settings
                  </h1>
                  <p className="text-xs text-slate-500 sm:text-sm">
                    Configure system-wide policies, defaults, and application preferences with a single control center.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/90 px-4 py-3 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200/80 backdrop-blur">
                <div
                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] ${statusTone} ring-1`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {statusText}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-500 sm:inline-flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-slate-400" />
                    Section
                  </span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-50 shadow-sm">
                    {sectionTitle(activeSection)}
                  </span>
                </div>
              </div>
              <nav
                aria-label="Admin settings navigation"
                className="flex overflow-x-auto rounded-xl bg-white/80 p-1 text-xs ring-1 ring-slate-200 shadow-sm lg:flex-col lg:overflow-visible"
              >
                {sectionOrder.map((section) => {
                  const selected = section === activeSection;
                  const icon =
                    section === "systemPolicies"
                      ? ShieldCheckIcon
                      : section === "applicationDefaults"
                      ? AdjustmentsHorizontalIcon
                      : GlobeAltIcon;
                  const Icon = icon;
                  const label = sectionTitle(section);
                  const description = sectionDescription(section);
                  return (
                    <button
                      key={section}
                      type="button"
                      onClick={() => setActiveSection(section)}
                      className={`group flex min-w-[10rem] flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 lg:min-w-0 ${
                        selected
                          ? "bg-slate-900 text-slate-50 shadow-sm"
                          : "bg-transparent text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border text-slate-600 transition-colors ${
                          selected
                            ? "border-slate-700 bg-slate-800 text-slate-50"
                            : "border-slate-200 bg-white group-hover:border-slate-300"
                        }`}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex flex-1 flex-col">
                        <span className="text-xs font-semibold">{label}</span>
                        <span className="text-[11px] text-slate-500 line-clamp-2">
                          {description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
            <section className="flex-1">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {sectionTitle(activeSection)}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {sectionDescription(activeSection)}
                      </p>
                    </div>
                    {!!settings?.updatedAt && (
                      <p className="text-[11px] text-slate-400">
                        Last updated just now
                      </p>
                    )}
                  </div>
                </div>
                <div className="px-6 py-6">
                  {loading && !settings ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                        Loading current configuration…
                      </div>
                    </div>
                  ) : (
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeSection}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      >
                        {renderSection()}
                      </motion.div>
                    </AnimatePresence>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </AuthGate>
  );
}

type SectionFooterProps = {
  section: SectionId;
  dirty: boolean;
  saving: boolean;
  error?: string;
  success?: string;
  onSave: () => void;
  onCancel: () => void;
  onResetDefaults: () => void;
};

function SectionFooter(props: SectionFooterProps) {
  const { dirty, saving, error, success, onSave, onCancel, onResetDefaults } = props;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={!dirty || saving}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onResetDefaults}
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg border border-transparent bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reset to defaults
        </button>
      </div>
      <div className="min-h-[1.25rem] text-xs">
        {error && <p className="text-rose-600">{error}</p>}
        {!error && success && <p className="text-emerald-600">{success}</p>}
        {!error && !success && dirty && (
          <p className="text-slate-500">You have unsaved changes in this section.</p>
        )}
      </div>
    </div>
  );
}
