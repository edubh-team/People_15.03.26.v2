"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  CreateMeetingInput,
  MeetingAudienceMode,
  MeetingAudienceResponse,
  MeetingDetailResponse,
  MeetingParticipantOption,
  UpdateMeetingInput,
} from "@/lib/types/meetings";

const ZOHO_MEETING_MAX_PARTICIPANTS = 100;

type FormState = {
  title: string;
  agenda: string;
  date: string;
  time: string;
  timezone: string;
  durationMinutes: string;
  additionalInviteEmails: string;
  audienceMode: MeetingAudienceMode;
  selectedDepartments: string[];
  selectedParticipantUids: string[];
  excludedParticipantUids: string[];
};

function todayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function nextRoundedTimeValue() {
  const next = new Date();
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

function buildInitialFormState(defaultTimezone: string): FormState {
  return {
    title: "",
    agenda: "",
    date: todayDateInputValue(),
    time: nextRoundedTimeValue(),
    timezone: defaultTimezone,
    durationMinutes: "30",
    additionalInviteEmails: "",
    audienceMode: "team",
    selectedDepartments: [],
    selectedParticipantUids: [],
    excludedParticipantUids: [],
  };
}

function parseAdditionalInviteEmails(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function CreateMeetingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingId = searchParams.get("meetingId");
  const zohoStatus = searchParams.get("zoho");
  const defaultTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Calcutta"
      : "Asia/Calcutta";

  const [directory, setDirectory] = useState<MeetingAudienceResponse | null>(null);
  const [form, setForm] = useState<FormState>(() => buildInitialFormState(defaultTimezone));
  const [participantSearch, setParticipantSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accountActionLoading, setAccountActionLoading] = useState<null | "switch" | "logout">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const audienceResponse = await fetch("/api/meetings/audience", { cache: "no-store" });
        const audiencePayload = (await audienceResponse.json().catch(() => null)) as
          | MeetingAudienceResponse
          | { error?: string }
          | null;
        if (!audienceResponse.ok) {
          throw new Error(
            audiencePayload && "error" in audiencePayload
              ? audiencePayload.error || "Unable to load meeting audience."
              : "Unable to load meeting audience.",
          );
        }
        if (!active) return;
        const typedAudience = audiencePayload as MeetingAudienceResponse;
        setDirectory(typedAudience);
        setForm((previous) => ({
          ...previous,
          timezone: previous.timezone || typedAudience.defaults.timezone || defaultTimezone,
        }));

        if (meetingId) {
          const detailResponse = await fetch(`/api/meetings/${meetingId}`, { cache: "no-store" });
          const detailPayload = (await detailResponse.json().catch(() => null)) as
            | MeetingDetailResponse
            | { error?: string }
            | null;
          if (!detailResponse.ok) {
            throw new Error(
              detailPayload && "error" in detailPayload
                ? detailPayload.error || "Unable to load meeting."
                : "Unable to load meeting.",
            );
          }
          if (!active) return;
          const detail = detailPayload as MeetingDetailResponse;
          setForm({
            title: detail.meeting.title,
            agenda: detail.meeting.agenda || "",
            date: detail.meeting.date,
            time: detail.meeting.time,
            timezone: detail.meeting.timezone,
            durationMinutes: String(detail.meeting.durationMinutes),
            additionalInviteEmails: (detail.meeting.externalParticipantEmails ?? []).join(", "),
            audienceMode: detail.meeting.audience.mode,
            selectedDepartments: detail.meeting.audience.departmentNames,
            selectedParticipantUids: detail.meeting.audience.participantUids,
            excludedParticipantUids: detail.meeting.audience.excludedParticipantUids ?? [],
          });
        }
      } catch (nextError) {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load meetings form.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [defaultTimezone, meetingId]);

  const previewParticipants = useMemo(() => {
    if (!directory) return [] as MeetingParticipantOption[];
    if (form.audienceMode === "team") {
      return directory.participants.filter((participant) =>
        !form.excludedParticipantUids.includes(participant.uid),
      );
    }
    if (form.audienceMode === "department") {
      return directory.participants.filter((participant) =>
        form.selectedDepartments.includes(participant.department || ""),
      );
    }
    return directory.participants.filter((participant) =>
      form.selectedParticipantUids.includes(participant.uid),
    );
  }, [directory, form.audienceMode, form.selectedDepartments, form.selectedParticipantUids]);

  const filteredParticipants = useMemo(() => {
    const term = participantSearch.trim().toLowerCase();
    if (!term || !directory) return directory?.participants ?? [];
    return directory.participants.filter((participant) => {
      const haystack = [
        participant.displayName,
        participant.email,
        participant.department,
        participant.employeeId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [directory, participantSearch]);

  const additionalInviteEmails = useMemo(
    () => parseAdditionalInviteEmails(form.additionalInviteEmails),
    [form.additionalInviteEmails],
  );
  const participantsByDepartment = useMemo(() => {
    const counts = new Map<string, number>();
    if (!directory) return counts;
    directory.participants.forEach((participant) => {
      const department = participant.department?.trim() || "Unassigned";
      counts.set(department, (counts.get(department) ?? 0) + 1);
    });
    return counts;
  }, [directory]);
  const departmentOptions = useMemo(() => {
    return Array.from(participantsByDepartment.entries())
      .map(([department, count]) => ({ department, count }))
      .sort((left, right) => {
        if (left.count !== right.count) return right.count - left.count;
        return left.department.localeCompare(right.department);
      });
  }, [participantsByDepartment]);
  const teamInviteCount = directory?.participants.length ?? 0;
  const currentCrmInviteCount = previewParticipants.length;
  const totalInviteCount = previewParticipants.length + additionalInviteEmails.length;
  const participantLimitExceeded = totalInviteCount > ZOHO_MEETING_MAX_PARTICIPANTS;
  const suggestedDepartments = departmentOptions.filter(
    (option) => option.count <= ZOHO_MEETING_MAX_PARTICIPANTS,
  );

  function buildRequestPayload(): CreateMeetingInput {
    const startTimeMs = new Date(`${form.date}T${form.time}:00`).getTime();
    return {
      title: form.title,
      agenda: form.agenda,
      date: form.date,
      time: form.time,
      timezone: form.timezone,
      startTimeMs,
      durationMinutes: Number(form.durationMinutes),
      additionalInviteEmails,
      audience: {
        mode: form.audienceMode,
        departmentNames: form.selectedDepartments,
        participantUids: form.selectedParticipantUids,
        excludedParticipantUids: form.excludedParticipantUids,
      },
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = buildRequestPayload();
      const requestBody: CreateMeetingInput | UpdateMeetingInput = meetingId
        ? { ...payload, meetingId }
        : payload;

      const response = await fetch(meetingId ? "/api/meetings/update" : "/api/meetings/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const responsePayload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(responsePayload?.error || "Unable to save meeting.");
      }
      router.push("/crm/meetings");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save meeting.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleZohoAccountAction(mode: "switch" | "logout") {
    setAccountActionLoading(mode);
    setError(null);

    try {
      const response = await fetch("/api/zoho/disconnect", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to disconnect Zoho Meeting.");
      }

      if (mode === "switch") {
        window.location.href = `/api/zoho/authorize?returnTo=${encodeURIComponent(meetingId ? `/crm/meetings/create?meetingId=${meetingId}` : "/crm/meetings/create")}`;
        return;
      }

      window.location.href = meetingId
        ? `/crm/meetings/create?meetingId=${encodeURIComponent(meetingId)}`
        : "/crm/meetings/create";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update Zoho Meeting login.");
    } finally {
      setAccountActionLoading(null);
    }
  }

  function toggleDepartment(name: string) {
    setForm((previous) => ({
      ...previous,
      selectedDepartments: previous.selectedDepartments.includes(name)
        ? previous.selectedDepartments.filter((entry) => entry !== name)
        : [...previous.selectedDepartments, name],
    }));
  }

  function toggleParticipant(uid: string) {
    setForm((previous) => ({
      ...previous,
      selectedParticipantUids: previous.selectedParticipantUids.includes(uid)
        ? previous.selectedParticipantUids.filter((entry) => entry !== uid)
        : [...previous.selectedParticipantUids, uid],
    }));
  }

  function toggleTeamExclusion(uid: string) {
    setForm((previous) => ({
      ...previous,
      excludedParticipantUids: previous.excludedParticipantUids.includes(uid)
        ? previous.excludedParticipantUids.filter((entry) => entry !== uid)
        : [...previous.excludedParticipantUids, uid],
    }));
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                CRM Meetings
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                {meetingId ? "Edit Meeting" : "Create Meeting"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Schedule team coordination with Zoho Meeting, persist it in Firestore, and keep attendance plus recordings linked back to the CRM.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/crm/meetings"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Upcoming Meetings
              </Link>
              <Link
                href="/crm/meetings/history"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Meeting History
              </Link>
            </div>
          </div>
        </section>

        {zohoStatus === "connected" ? (
          <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Zoho Meeting connected successfully.
          </div>
        ) : null}
        {zohoStatus === "error" ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Zoho Meeting connection failed. Try connecting again.
          </div>
        ) : null}
        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading meetings form...
          </div>
        ) : null}

        {!loading && directory && !directory.zohoConnected ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold text-amber-900">Connect Zoho Meeting first</div>
                <p className="mt-1 text-sm text-amber-800">
                  The Meetings module is ready, but this account needs a Zoho OAuth connection before it can create or sync meetings.
                </p>
              </div>
              <a
                href={`/api/zoho/authorize?returnTo=${encodeURIComponent(meetingId ? `/crm/meetings/create?meetingId=${meetingId}` : "/crm/meetings/create")}`}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Connect Zoho
              </a>
            </div>
          </div>
        ) : null}

        {!loading && directory?.zohoConnected ? (
          <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[1.4fr,0.9fr]">
            <section className="space-y-5 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Zoho Meeting Account</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Connected as {directory.zohoConnection?.primaryEmail || "current Zoho account"}
                      {directory.zohoConnection?.portalName ? ` on ${directory.zohoConnection.portalName}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleZohoAccountAction("switch")}
                      disabled={Boolean(accountActionLoading)}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      {accountActionLoading === "switch" ? "Switching..." : "Change Zoho Login"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleZohoAccountAction("logout")}
                      disabled={Boolean(accountActionLoading)}
                      className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      {accountActionLoading === "logout" ? "Logging out..." : "Logout Zoho"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-900">Title</span>
                  <input
                    required
                    value={form.title}
                    onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    placeholder="Quarterly pipeline review"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-900">Agenda</span>
                  <textarea
                    value={form.agenda}
                    onChange={(event) => setForm((previous) => ({ ...previous, agenda: event.target.value }))}
                    rows={5}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    placeholder="Discuss blockers, ownership, and next-week action plan."
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-900">Additional Invite Emails</span>
                  <textarea
                    value={form.additionalInviteEmails}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, additionalInviteEmails: event.target.value }))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    placeholder="client@example.com, partner@example.com"
                  />
                  <p className="text-xs text-slate-500">
                    Add invitees outside the CRM using commas, semicolons, or new lines.
                  </p>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-900">Date</span>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(event) => setForm((previous) => ({ ...previous, date: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-900">Time</span>
                  <input
                    type="time"
                    required
                    value={form.time}
                    onChange={(event) => setForm((previous) => ({ ...previous, time: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-900">Duration (minutes)</span>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    required
                    value={form.durationMinutes}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, durationMinutes: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-900">Timezone</span>
                  <input
                    required
                    value={form.timezone}
                    onChange={(event) => setForm((previous) => ({ ...previous, timezone: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    placeholder="Asia/Calcutta"
                  />
                </label>
              </div>

              <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Participant Selection</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    ["team", "Entire Team"],
                    ["department", "Department"],
                    ["individual", "Individual Employees"],
                  ] as Array<[MeetingAudienceMode, string]>).map(([mode, label]) => (
                    (() => {
                      const count =
                        mode === "team"
                          ? teamInviteCount
                          : mode === "department"
                            ? currentCrmInviteCount
                            : currentCrmInviteCount;
                      return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm((previous) => ({ ...previous, audienceMode: mode }))}
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                        form.audienceMode === mode
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="block">{label}</span>
                      <span className={`mt-1 block text-xs ${form.audienceMode === mode ? "text-slate-200" : "text-slate-500"}`}>
                        {count} CRM invitee{count === 1 ? "" : "s"}
                      </span>
                    </button>
                      );
                    })()
                  ))}
                </div>

                {form.audienceMode === "team" && teamInviteCount > ZOHO_MEETING_MAX_PARTICIPANTS ? (
                  <div className="rounded-[20px] border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-semibold text-amber-900">
                      Entire Team is over the Zoho limit
                    </div>
                    <p className="mt-1 text-sm text-amber-800">
                      Your current CRM team selection includes {teamInviteCount} employees. Zoho Meeting allows up to {ZOHO_MEETING_MAX_PARTICIPANTS} invitees per meeting, so it helps to split by department.
                    </p>
                    {suggestedDepartments.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {suggestedDepartments.slice(0, 8).map((option) => (
                          <button
                            key={option.department}
                            type="button"
                            onClick={() =>
                              setForm((previous) => ({
                                ...previous,
                                audienceMode: "department",
                                selectedDepartments: [option.department],
                              }))
                            }
                            className="rounded-full border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                          >
                            Use {option.department} ({option.count})
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {form.audienceMode === "team" ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">Unselect from Entire Team</div>
                      <div className="text-xs text-slate-500">
                        {form.excludedParticipantUids.length} excluded
                      </div>
                    </div>
                    <input
                      value={participantSearch}
                      onChange={(event) => setParticipantSearch(event.target.value)}
                      placeholder="Search team members to exclude"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                    />
                    <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
                      {filteredParticipants.map((participant) => {
                        const included = !form.excludedParticipantUids.includes(participant.uid);
                        return (
                          <label
                            key={participant.uid}
                            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={() => toggleTeamExclusion(participant.uid)}
                            />
                            <span>
                              <span className="block font-semibold text-slate-900">{participant.displayName}</span>
                              <span className="block text-xs text-slate-500">
                                {participant.email || "No email"} · {participant.department || "No department"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {form.audienceMode === "department" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {departmentOptions.map(({ department, count }) => (
                      <label
                        key={department}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={form.selectedDepartments.includes(department)}
                          onChange={() => toggleDepartment(department)}
                        />
                        <span className="flex-1">{department}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          {count}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}

                {form.audienceMode === "individual" ? (
                  <div className="space-y-3">
                    <input
                      value={participantSearch}
                      onChange={(event) => setParticipantSearch(event.target.value)}
                      placeholder="Search employees by name, email, department, or employee ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                    />
                    <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
                      {filteredParticipants.map((participant) => (
                        <label
                          key={participant.uid}
                          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={form.selectedParticipantUids.includes(participant.uid)}
                            onChange={() => toggleParticipant(participant.uid)}
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">{participant.displayName}</span>
                            <span className="block text-xs text-slate-500">
                              {participant.email || "No email"} · {participant.department || "No department"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="space-y-5">
              <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-lg font-semibold text-slate-900">Live Participant Preview</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  The system auto-populates participants from your current scope and sends their emails to Zoho Meeting.
                </p>
                <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Selected
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-slate-900">
                    {totalInviteCount}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {form.audienceMode === "team"
                      ? "Entire scoped team"
                      : form.audienceMode === "department"
                        ? "Department selection"
                        : "Individual employee selection"}
                  </div>
                  {additionalInviteEmails.length > 0 ? (
                    <div className="mt-2 text-sm text-slate-500">
                      + {additionalInviteEmails.length} external invite{additionalInviteEmails.length === 1 ? "" : "s"}
                    </div>
                  ) : null}
                  {participantLimitExceeded ? (
                    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                      Zoho Meeting allows up to {ZOHO_MEETING_MAX_PARTICIPANTS} invitees per meeting. Current selection: {totalInviteCount}.
                    </div>
                  ) : null}
                </div>
                {departmentOptions.length > 0 ? (
                  <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Department Breakdown
                    </div>
                    <div className="mt-3 grid gap-2">
                      {departmentOptions.slice(0, 6).map((option) => (
                        <button
                          key={option.department}
                          type="button"
                          onClick={() =>
                            setForm((previous) => ({
                              ...previous,
                              audienceMode: "department",
                              selectedDepartments: [option.department],
                            }))
                          }
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100"
                        >
                          <span className="text-sm font-medium text-slate-900">{option.department}</span>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                            {option.count}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Tap a department to switch the meeting scope quickly.
                    </p>
                  </div>
                ) : null}
                <div className="mt-4 space-y-2">
                  {previewParticipants.slice(0, 8).map((participant) => (
                    <div
                      key={participant.uid}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="font-medium text-slate-900">{participant.displayName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {participant.email || "No email"} · {participant.department || "No department"}
                      </div>
                    </div>
                  ))}
                  {previewParticipants.length > 8 ? (
                    <div className="text-xs text-slate-500">
                      +{previewParticipants.length - 8} more participants
                    </div>
                  ) : null}
                  {additionalInviteEmails.slice(0, 5).map((email) => (
                    <div
                      key={email}
                      className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-3"
                    >
                      <div className="font-medium text-slate-900">{email}</div>
                      <div className="mt-1 text-xs text-slate-500">External invite</div>
                    </div>
                  ))}
                  {additionalInviteEmails.length > 5 ? (
                    <div className="text-xs text-slate-500">
                      +{additionalInviteEmails.length - 5} more external invites
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-lg font-semibold text-slate-900">Execution</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Creating or updating a meeting will sync Zoho Meeting, persist the Firestore records, and prepare attendance plus recordings tracking.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={submitting || participantLimitExceeded}
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {submitting
                      ? (meetingId ? "Updating..." : "Creating...")
                      : (meetingId ? "Update Meeting" : "Create Meeting")}
                  </button>
                  <Link
                    href="/crm/meetings"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </Link>
                </div>
              </section>
            </aside>
          </form>
        ) : null}
      </div>
    </div>
  );
}
