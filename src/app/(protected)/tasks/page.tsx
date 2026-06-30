"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Squares2X2Icon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import MultiSelectCombobox from "@/components/ui/MultiSelectCombobox";
import { db } from "@/lib/firebase/client";
import { getLeadTaskReferenceById } from "@/lib/tasks/lead-links";
import {
  buildTaskLeadWriteFields,
  buildTaskWriteFields,
  getTaskLeadIntegrity,
  type TaskLeadIntegrityState,
} from "@/lib/tasks/model";
import {
  addDays,
  buildTaskStats,
  filterTasks,
  getCalendarDays,
  getTaskDeadline,
  groupTasksByBucket,
  isTaskCompleted,
  isTaskOnDay,
  isTaskOverdue,
  normalizeWorkbenchTask,
  startOfWeek,
  toDate,
  type TaskDoc,
  type TaskPriority,
  type TaskQuickFilter,
  type TaskStatus,
} from "@/lib/tasks/workbench";
import { canManageTeam, isAdminUser, isHrUser } from "@/lib/access";
import { useTeamManagementScope } from "@/lib/hooks/useTeamManagementScope";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

type ScopeMode = "my" | "team";
type ViewMode = "list" | "calendar";
type ComposerState = {
  assigneeUids: string[];
  title: string;
  description: string;
  priority: TaskPriority;
  deadline: string;
  category: string;
  tags: string;
  leadId: string;
  leadName: string;
};

type CommentDoc = {
  id: string;
  text: string;
  userId: string;
  userName: string;
  createdAt: unknown;
};

type ComposerLeadLookup = {
  state: "idle" | "loading" | "valid" | "missing";
  lead: LeadDoc | null;
};

const QUICK_FILTERS: Array<{ id: TaskQuickFilter; label: string }> = [
  { id: "all_active", label: "All Active" },
  { id: "due_today", label: "Due Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
  { id: "lead_linked", label: "Lead Linked" },
  { id: "link_issues", label: "Link Issues" },
];

function chunk<T>(values: T[], size = 10) {
  const parts: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    parts.push(values.slice(index, index + size));
  }
  return parts;
}

function mergeTaskRows(rows: TaskDoc[]) {
  const map = new Map<string, TaskDoc>();
  rows.forEach((task) => map.set(task.id, task));
  return Array.from(map.values());
}

function getUserLabel(user: Pick<UserDoc, "uid" | "displayName" | "email" | "orgRole" | "role"> | undefined) {
  if (!user) return "Unknown";
  return user.displayName ?? user.email ?? user.uid;
}

function toneForPriority(priority: TaskPriority) {
  if (priority === "high") return "bg-rose-50 text-rose-700 border-rose-200";
  if (priority === "medium") return "bg-indigo-50 text-indigo-700 border-indigo-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function statusTone(status: TaskStatus) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "in_progress") return "bg-indigo-50 text-indigo-700 border-indigo-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function leadIntegrityTone(state: TaskLeadIntegrityState | undefined) {
  if (state === "orphaned") return "border-rose-200 bg-rose-50 text-rose-700";
  if (state === "owner_mismatch") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function leadIntegrityLabel(state: TaskLeadIntegrityState | undefined) {
  if (state === "orphaned") return "Lead missing";
  if (state === "owner_mismatch") return "Owner drift";
  return "Lead linked";
}

function formatShortDate(value: unknown) {
  if (!value) return "No deadline";
  return toDate(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard(props: { label: string; value: number; hint: string; icon: typeof ClockIcon }) {
  const Icon = props.icon;
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.label}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{props.value}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-2 text-sm text-slate-500">{props.hint}</div>
    </div>
  );
}

function TaskRow(props: {
  task: TaskDoc;
  selected: boolean;
  onToggle: (taskId: string) => void;
  onOpen: (task: TaskDoc) => void;
  assigneeLabel: string;
}) {
  const deadline = getTaskDeadline(props.task);
  const overdue = isTaskOverdue(props.task);

  return (
    <article className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={() => props.onToggle(props.task.id)}
          className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{props.task.title}</h3>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(props.task.status)}`}>
              {props.task.status.replace("_", " ")}
            </span>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneForPriority(props.task.priority)}`}>
              {props.task.priority}
            </span>
            {props.task.leadId ? (
              <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                Lead linked
              </span>
            ) : null}
            {props.task.leadIntegrityState === "orphaned" || props.task.leadIntegrityState === "owner_mismatch" ? (
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${leadIntegrityTone(props.task.leadIntegrityState)}`}>
                {leadIntegrityLabel(props.task.leadIntegrityState)}
              </span>
            ) : null}
            {overdue ? (
              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                Overdue
              </span>
            ) : null}
          </div>

          {props.task.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{props.task.description}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Assignee: {props.assigneeLabel}</span>
            <span>Deadline: {deadline ? formatShortDate(deadline) : "No deadline"}</span>
            <span>Category: {props.task.category ?? "General"}</span>
            {props.task.leadId ? <span>Lead: {props.task.leadName ?? props.task.leadId}</span> : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => props.onOpen(props.task)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Open
        </button>
      </div>
    </article>
  );
}

function ListSection(props: {
  title: string;
  hint: string;
  tasks: TaskDoc[];
  selectedIds: Set<string>;
  onToggle: (taskId: string) => void;
  onOpen: (task: TaskDoc) => void;
  userLookup: Map<string, UserDoc>;
}) {
  if (props.tasks.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{props.title}</div>
          <div className="mt-1 text-sm text-slate-500">{props.hint}</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
          {props.tasks.length}
        </div>
      </div>

      <div className="space-y-3">
        {props.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={props.selectedIds.has(task.id)}
            onToggle={props.onToggle}
            onOpen={props.onOpen}
            assigneeLabel={getUserLabel(props.userLookup.get(task.assignedTo ?? task.assigneeUid ?? ""))}
          />
        ))}
      </div>
    </section>
  );
}

function TaskDetailDrawer(props: {
  task: TaskDoc | null;
  isOpen: boolean;
  onClose: () => void;
  comments: CommentDoc[];
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onAddComment: () => void;
  isSubmittingComment: boolean;
  onStatusChange: (task: TaskDoc, status: TaskStatus) => void;
  assigneeLabel: string;
}) {
  if (!props.isOpen || !props.task) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={props.onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md border-l border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{props.task.title}</div>
            <div className="mt-1 text-sm text-slate-500">{props.task.category ?? "General"}</div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(props.task.status)}`}>
            {props.task.status.replace("_", " ")}
          </span>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneForPriority(props.task.priority)}`}>
            {props.task.priority}
          </span>
          {props.task.leadId ? (
            <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              {props.task.leadName ?? props.task.leadId}
            </span>
          ) : null}
        </div>

        <div className="mt-5 space-y-4 text-sm text-slate-600">
          {props.task.description ? <p className="leading-6">{props.task.description}</p> : <p>No description added.</p>}
          <div className="grid gap-3 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
            <div><span className="font-semibold text-slate-700">Assignee:</span> {props.assigneeLabel}</div>
            <div><span className="font-semibold text-slate-700">Created:</span> {formatShortDate(props.task.createdAt)}</div>
            <div><span className="font-semibold text-slate-700">Deadline:</span> {props.task.deadline ? formatShortDate(props.task.deadline) : "No deadline"}</div>
            <div><span className="font-semibold text-slate-700">Task ID:</span> {props.task.id}</div>
            {props.task.leadId ? <div><span className="font-semibold text-slate-700">Linked lead:</span> {props.task.leadName ?? props.task.leadId}</div> : null}
            {props.task.leadId ? <div><span className="font-semibold text-slate-700">Lead owner:</span> {props.task.leadOwnerUid ?? "Unknown"}</div> : null}
          </div>
          {props.task.leadIntegrityState === "orphaned" ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              This task still points to a lead ID that no longer resolves in CRM.
            </div>
          ) : null}
          {props.task.leadIntegrityState === "owner_mismatch" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              The linked lead has moved to another owner. Reassign or complete this task before it goes stale.
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {props.task.status === "pending" ? (
            <button type="button" onClick={() => props.onStatusChange(props.task!, "in_progress")} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Start task</button>
          ) : null}
          {props.task.status !== "completed" ? (
            <button type="button" onClick={() => props.onStatusChange(props.task!, "completed")} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Mark complete</button>
          ) : (
            <button type="button" onClick={() => props.onStatusChange(props.task!, "pending")} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Reopen</button>
          )}
          {props.task.status === "in_progress" ? (
            <button type="button" onClick={() => props.onStatusChange(props.task!, "pending")} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Move back to pending</button>
          ) : null}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="text-sm font-semibold text-slate-900">Comments</div>
          <div className="mt-3 space-y-3 max-h-[260px] overflow-y-auto pr-1">
            {props.comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No comments yet.
              </div>
            ) : (
              props.comments.map((comment) => (
                <article key={comment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-700">{comment.userName}</div>
                    <div className="text-[11px] text-slate-400">{formatShortDate(comment.createdAt)}</div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{comment.text}</div>
                </article>
              ))
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={props.commentText}
              onChange={(event) => props.onCommentTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !props.isSubmittingComment) props.onAddComment();
              }}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
              placeholder="Add an update or completion note..."
            />
            <button
              type="button"
              onClick={props.onAddComment}
              disabled={props.isSubmittingComment || !props.commentText.trim()}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {props.isSubmittingComment ? "Posting..." : "Post"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ComposerDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  state: ComposerState;
  leadLookup: ComposerLeadLookup;
  onChange: (patch: Partial<ComposerState>) => void;
  onSubmit: () => void;
  assigneeOptions: Array<{ value: string; label: string; subLabel?: string }>;
  isSubmitting: boolean;
}) {
  if (!props.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={props.onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md border-l border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">Create Task</div>
            <div className="mt-1 text-sm text-slate-500">Assign the next action without leaving the execution desk.</div>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4 overflow-y-auto">
          <MultiSelectCombobox
            label="Assignees"
            value={props.state.assigneeUids}
            onChange={(value) => props.onChange({ assigneeUids: value })}
            options={props.assigneeOptions}
            placeholder="Select task owners..."
          />
          <div>
            <label className="block text-xs font-medium text-slate-600">Title</label>
            <input type="text" value={props.state.title} onChange={(event) => props.onChange({ title: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Description</label>
            <textarea value={props.state.description} onChange={(event) => props.onChange({ description: event.target.value })} rows={4} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Priority</label>
              <select value={props.state.priority} onChange={(event) => props.onChange({ priority: event.target.value as TaskPriority })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Category</label>
              <input type="text" value={props.state.category} onChange={(event) => props.onChange({ category: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Deadline</label>
            <input type="datetime-local" value={props.state.deadline} onChange={(event) => props.onChange({ deadline: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Lead ID</label>
            <input type="text" value={props.state.leadId} onChange={(event) => props.onChange({ leadId: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="Optional lead reference" />
            {props.leadLookup.state === "loading" ? <div className="mt-2 text-xs text-slate-500">Checking CRM lead...</div> : null}
            {props.leadLookup.state === "valid" && props.leadLookup.lead ? <div className="mt-2 text-xs text-emerald-700">Linked to {props.leadLookup.lead.name}.</div> : null}
            {props.leadLookup.state === "missing" ? <div className="mt-2 text-xs text-rose-600">Lead ID not found. This task will not save until the link is valid or cleared.</div> : null}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Lead Name</label>
            <input type="text" value={props.state.leadName} onChange={(event) => props.onChange({ leadName: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="Optional lead name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Tags</label>
            <input type="text" value={props.state.tags} onChange={(event) => props.onChange({ tags: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="Comma-separated tags" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button type="button" onClick={props.onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={props.onSubmit} disabled={props.isSubmitting || props.state.assigneeUids.length === 0 || !props.state.title.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{props.isSubmitting ? "Creating..." : "Create task"}</button>
        </div>
      </aside>
    </div>
  );
}

export default function TasksPage() {
  const { firebaseUser, userDoc } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const searchParams = useSearchParams();
  const { scopedUsers } = useTeamManagementScope(userDoc);

  const isAdminScope = isAdminUser(userDoc) || isHrUser(userDoc);
  const canSeeTeamView = canManageTeam(userDoc) || isHrUser(userDoc);

  const [allActiveUsers, setAllActiveUsers] = useState<UserDoc[]>([]);
  const [personalTasks, setPersonalTasks] = useState<TaskDoc[]>([]);
  const [teamTasks, setTeamTasks] = useState<TaskDoc[]>([]);
  const [scopeMode, setScopeMode] = useState<ScopeMode>(canSeeTeamView ? "team" : "my");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [quickFilter, setQuickFilter] = useState<TaskQuickFilter>(canSeeTeamView ? "overdue" : "due_today");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskDoc | null>(null);
  const [comments, setComments] = useState<CommentDoc[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [bulkDeadline, setBulkDeadline] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSaving, setComposerSaving] = useState(false);
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date());
  const [leadIndex, setLeadIndex] = useState<Map<string, LeadDoc | null>>(new Map());
  const [composerLeadLookup, setComposerLeadLookup] = useState<ComposerLeadLookup>({ state: "idle", lead: null });
  const [composer, setComposer] = useState<ComposerState>({
    assigneeUids: uid ? [uid] : [],
    title: "",
    description: "",
    priority: "medium",
    deadline: "",
    category: "General",
    tags: "",
    leadId: "",
    leadName: "",
  });

  useEffect(() => {
    setScopeMode(canSeeTeamView ? "team" : "my");
    setQuickFilter(canSeeTeamView ? "overdue" : "due_today");
  }, [canSeeTeamView, uid]);

  useEffect(() => {
    if (!db || !uid) return;
    if (isAdminScope) {
      return onSnapshot(query(collection(db, "users"), where("status", "==", "active"), limit(1000)), (snapshot) => {
        setAllActiveUsers(snapshot.docs.map((item) => item.data() as UserDoc));
      });
    }
    setAllActiveUsers(scopedUsers);
    return undefined;
  }, [isAdminScope, scopedUsers, uid]);

  const teamScopeIds = useMemo(() => {
    if (!canSeeTeamView) return [];
    if (isAdminScope) {
      return allActiveUsers.map((user) => user.uid).filter((candidate) => candidate && candidate !== uid);
    }
    return scopedUsers.map((user) => user.uid).filter((candidate) => candidate && candidate !== uid);
  }, [allActiveUsers, canSeeTeamView, isAdminScope, scopedUsers, uid]);

  const userLookup = useMemo(() => {
    const map = new Map<string, UserDoc>();
    if (userDoc) map.set(userDoc.uid, userDoc);
    allActiveUsers.forEach((user) => map.set(user.uid, user));
    scopedUsers.forEach((user) => map.set(user.uid, user));
    return map;
  }, [allActiveUsers, scopedUsers, userDoc]);

  const assigneeOptions = useMemo(() => {
    const entries: Array<[string, UserDoc]> = [];
    if (userDoc) entries.push([userDoc.uid, userDoc]);
    allActiveUsers.forEach((user) => entries.push([user.uid, user]));
    scopedUsers.forEach((user) => entries.push([user.uid, user]));

    const users = canSeeTeamView
      ? Array.from(new Map<string, UserDoc>(entries).values())
      : userDoc
        ? [userDoc]
        : [];

    return users
      .map((user) => ({
        value: user.uid,
        label: getUserLabel(user),
        subLabel: user.orgRole ?? user.role,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allActiveUsers, canSeeTeamView, scopedUsers, userDoc]);

  useEffect(() => {
    if (!uid) return;
    setComposer((previous) => ({
      ...previous,
      assigneeUids: previous.assigneeUids.length > 0 ? previous.assigneeUids : [uid],
    }));
  }, [uid]);

  useEffect(() => {
    const leadId = composer.leadId.trim();
    if (!leadId) {
      setComposerLeadLookup({ state: "idle", lead: null });
      return;
    }
    if (!db) return;

    let active = true;
    const timer = window.setTimeout(() => {
      setComposerLeadLookup({ state: "loading", lead: null });
      getLeadTaskReferenceById(leadId)
        .then((lead) => {
          if (!active) return;
          if (!lead) {
            setComposerLeadLookup({ state: "missing", lead: null });
            return;
          }
          setComposerLeadLookup({ state: "valid", lead });
          setComposer((previous) =>
            previous.leadId.trim() === leadId
              ? { ...previous, leadName: lead.name }
              : previous,
          );
        })
        .catch((error) => {
          console.error("Failed to validate linked lead", error);
          if (active) setComposerLeadLookup({ state: "missing", lead: null });
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [composer.leadId]);

  useEffect(() => {
    if (!db || !uid) return;
    const taskMap = new Map<string, TaskDoc>();

    const sync = () => setPersonalTasks(Array.from(taskMap.values()));
    const handleSnapshot = (snapshot: { docChanges: () => Array<{ type: string; doc: { id: string; data: () => Record<string, unknown> } }> }) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          taskMap.delete(change.doc.id);
        } else {
          taskMap.set(change.doc.id, normalizeWorkbenchTask(change.doc.data(), change.doc.id));
        }
      });
      sync();
    };
    const handleError = (error: unknown) => {
      if ((error as { code?: string }).code === "permission-denied") return;
      console.error("Personal tasks listener error", error);
    };

    const unsubs = [
      onSnapshot(query(collection(db, "tasks"), where("assignedTo", "==", uid), limit(600)), handleSnapshot, handleError),
      onSnapshot(query(collection(db, "tasks"), where("assigneeUid", "==", uid), limit(600)), handleSnapshot, handleError),
    ];

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [uid]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !canSeeTeamView || teamScopeIds.length === 0) {
      setTeamTasks([]);
      return undefined;
    }

    const taskMap = new Map<string, TaskDoc>();
    const sync = () => setTeamTasks(Array.from(taskMap.values()));
    const handleSnapshot = (snapshot: { docChanges: () => Array<{ type: string; doc: { id: string; data: () => Record<string, unknown> } }> }) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          taskMap.delete(change.doc.id);
        } else {
          taskMap.set(change.doc.id, normalizeWorkbenchTask(change.doc.data(), change.doc.id));
        }
      });
      sync();
    };
    const handleError = (error: unknown) => {
      if ((error as { code?: string }).code === "permission-denied") return;
      console.error("Team tasks listener error", error);
    };

    const unsubs = chunk(Array.from(new Set(teamScopeIds))).flatMap((part) => [
      onSnapshot(query(collection(firestore, "tasks"), where("assignedTo", "in", part), limit(800)), handleSnapshot, handleError),
      onSnapshot(query(collection(firestore, "tasks"), where("assigneeUid", "in", part), limit(800)), handleSnapshot, handleError),
    ]);

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [canSeeTeamView, teamScopeIds.join("|")]);

  const scopeTasks = useMemo(() => {
    if (scopeMode === "team") return mergeTaskRows([...personalTasks, ...teamTasks]);
    return personalTasks;
  }, [personalTasks, scopeMode, teamTasks]);

  useEffect(() => {
    const firestore = db;
    const leadIds = Array.from(
      new Set(
        scopeTasks
          .map((task) => task.leadId?.trim())
          .filter((leadId): leadId is string => Boolean(leadId)),
      ),
    );

    if (!firestore || leadIds.length === 0) {
      setLeadIndex(new Map());
      return undefined;
    }

    const nextIndex = new Map<string, LeadDoc | null>();
    setLeadIndex(new Map());
    const unsubs = leadIds.map((leadId) =>
      onSnapshot(
        doc(firestore, "leads", leadId),
        (snapshot) => {
          nextIndex.set(leadId, snapshot.exists() ? ({ ...(snapshot.data() as LeadDoc), leadId: snapshot.id } as LeadDoc) : null);
          setLeadIndex(new Map(nextIndex));
        },
        (error) => {
          if ((error as { code?: string }).code === "permission-denied") return;
          console.error("Lead integrity listener error", error);
        },
      ),
    );

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [scopeTasks]);

  const decoratedScopeTasks = useMemo(
    () =>
      scopeTasks.map((task) => {
        const leadId = task.leadId?.trim() ?? "";
        const linkedLead = leadId && leadIndex.has(leadId) ? leadIndex.get(leadId) ?? null : undefined;
        const leadIntegrityState = task.leadId
          ? linkedLead === undefined
            ? task.leadIntegrityState ?? "linked"
            : getTaskLeadIntegrity(task, linkedLead)
          : "unlinked";

        return {
          ...task,
          leadIntegrityState,
          leadName: linkedLead?.name ?? task.leadName ?? null,
          leadStatus: linkedLead ? String(linkedLead.status ?? "") : task.leadStatus ?? null,
          leadOwnerUid: linkedLead?.assignedTo ?? linkedLead?.ownerUid ?? task.leadOwnerUid ?? null,
        } satisfies TaskDoc;
      }),
    [leadIndex, scopeTasks],
  );

  const taskStats = useMemo(() => buildTaskStats(decoratedScopeTasks), [decoratedScopeTasks]);
  const categories = useMemo(() => {
    const values = new Set<string>();
    decoratedScopeTasks.forEach((task) => {
      if (task.category?.trim()) values.add(task.category.trim());
    });
    return ["all", ...Array.from(values).sort((left, right) => left.localeCompare(right))];
  }, [decoratedScopeTasks]);
  const filteredTasks = useMemo(
    () => filterTasks(decoratedScopeTasks, { quickFilter, searchTerm, category: categoryFilter }),
    [categoryFilter, decoratedScopeTasks, quickFilter, searchTerm],
  );
  const groupedTasks = useMemo(() => groupTasksByBucket(filteredTasks), [filteredTasks]);
  const selectedTaskSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const calendarDays = useMemo(() => getCalendarDays(calendarAnchor), [calendarAnchor]);
  const unscheduledTasks = useMemo(
    () => filteredTasks.filter((task) => !task.deadline && !isTaskCompleted(task)),
    [filteredTasks],
  );
  const overdueTasks = useMemo(
    () => filteredTasks.filter((task) => isTaskOverdue(task)),
    [filteredTasks],
  );

  useEffect(() => {
    setSelectedTaskIds((previous) => previous.filter((taskId) => filteredTasks.some((task) => task.id === taskId)));
  }, [filteredTasks]);

  const taskId = searchParams.get("taskId");
  useEffect(() => {
    if (!taskId || !db || !uid) return;
    const existing = decoratedScopeTasks.find((task) => task.id === taskId);
    if (existing) {
      setSelectedTask(existing);
      return;
    }

    getDoc(doc(db as Firestore, "tasks", taskId))
      .then((snapshot) => {
        if (snapshot.exists()) setSelectedTask(normalizeWorkbenchTask(snapshot.data() as Record<string, unknown>, snapshot.id));
      })
      .catch((error) => {
        if ((error as { code?: string }).code === "permission-denied") return;
        console.error("Failed to load linked task", error);
      });
  }, [db, decoratedScopeTasks, taskId, uid]);

  useEffect(() => {
    if (!selectedTask || !db) {
      setComments([]);
      return undefined;
    }
    return onSnapshot(query(collection(db, "tasks", selectedTask.id, "comments"), limit(100)), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CommentDoc));
      rows.sort((left, right) => toDate(left.createdAt).getTime() - toDate(right.createdAt).getTime());
      setComments(rows);
    });
  }, [db, selectedTask]);

  useEffect(() => {
    if (!selectedTask) return;
    const fresh = decoratedScopeTasks.find((task) => task.id === selectedTask.id);
    if (fresh) setSelectedTask(fresh);
  }, [decoratedScopeTasks, selectedTask]);

  async function updateTaskStatus(task: TaskDoc, status: TaskStatus) {
    if (!db) return;
    try {
      await setDoc(
        doc(db, "tasks", task.id),
        {
          status,
          completedAt: status === "completed" ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.error("Failed to update task status", error);
      alert("Failed to update task status.");
    }
  }

  async function addComment() {
    if (!db || !uid || !selectedTask || !commentText.trim() || commentSaving) return;
    setCommentSaving(true);
    try {
      await addDoc(collection(db, "tasks", selectedTask.id, "comments"), {
        text: commentText.trim(),
        userId: uid,
        userName: userDoc?.displayName || userDoc?.email || "User",
        createdAt: serverTimestamp(),
      });
      setCommentText("");
    } catch (error) {
      console.error("Failed to add comment", error);
      alert("Failed to add comment.");
    } finally {
      setCommentSaving(false);
    }
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId)
        ? previous.filter((item) => item !== taskId)
        : [...previous, taskId],
    );
  }

  function toggleVisibleSelection() {
    if (selectedTaskIds.length === filteredTasks.length) {
      setSelectedTaskIds([]);
      return;
    }
    setSelectedTaskIds(filteredTasks.map((task) => task.id));
  }

  async function bulkComplete() {
    const firestore = db;
    if (!firestore || selectedTaskIds.length === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        selectedTaskIds.map((taskId) =>
          setDoc(
            doc(firestore, "tasks", taskId),
            { status: "completed", completedAt: serverTimestamp(), updatedAt: serverTimestamp() },
            { merge: true },
          ),
        ),
      );
      setSelectedTaskIds([]);
    } catch (error) {
      console.error("Bulk complete failed", error);
      alert("Failed to complete selected tasks.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkReschedule() {
    const firestore = db;
    if (!firestore || selectedTaskIds.length === 0 || !bulkDeadline) return;
    setBulkSaving(true);
    try {
      const nextDeadline = new Date(bulkDeadline);
      await Promise.all(
        selectedTaskIds.map((taskId) =>
          setDoc(
            doc(firestore, "tasks", taskId),
            { deadline: nextDeadline, updatedAt: serverTimestamp() },
            { merge: true },
          ),
        ),
      );
      setSelectedTaskIds([]);
      setBulkDeadline("");
    } catch (error) {
      console.error("Bulk reschedule failed", error);
      alert("Failed to reschedule selected tasks.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function createTasks() {
    const firestore = db;
    if (!firestore || !uid || composer.assigneeUids.length === 0 || !composer.title.trim()) return;
    setComposerSaving(true);
    try {
      const deadline = composer.deadline ? new Date(composer.deadline) : null;
      const tags = composer.tags.split(",").map((value) => value.trim()).filter(Boolean);
      const linkedLeadId = composer.leadId.trim();
      const linkedLead =
        linkedLeadId.length === 0
          ? null
          : composerLeadLookup.state === "valid" && composerLeadLookup.lead?.leadId === linkedLeadId
            ? composerLeadLookup.lead
            : await getLeadTaskReferenceById(linkedLeadId);

      if (linkedLeadId && !linkedLead) {
        alert("Linked lead was not found. Clear the Lead ID or use a valid lead.");
        return;
      }

      await Promise.all(
        composer.assigneeUids.map(async (assigneeUid) => {
          const taskRef = doc(collection(firestore, "tasks"));
          await setDoc(taskRef, {
            id: taskRef.id,
            title: composer.title.trim(),
            description: composer.description.trim(),
            ...buildTaskWriteFields({ assigneeUid, creatorUid: uid }),
            status: "pending",
            priority: composer.priority,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            completedAt: null,
            deadline,
            category: composer.category.trim() || "General",
            tags,
            attachments: [],
            ...(linkedLead ? buildTaskLeadWriteFields({ lead: linkedLead }) : { leadId: null, leadName: null, leadStatus: null, leadOwnerUid: null }),
          });

          if (assigneeUid !== uid) {
            await addDoc(collection(firestore, "notifications"), {
              recipientUid: assigneeUid,
              title: "New Task Assigned",
              body: `${userDoc?.displayName ?? "A manager"} assigned you: ${composer.title.trim()}`,
              read: false,
              createdAt: serverTimestamp(),
              relatedTaskId: taskRef.id,
              priority: composer.priority,
            });
          }
        }),
      );

      setComposer({
        assigneeUids: uid ? [uid] : [],
        title: "",
        description: "",
        priority: "medium",
        deadline: "",
        category: "General",
        tags: "",
        leadId: "",
        leadName: "",
      });
      setComposerLeadLookup({ state: "idle", lead: null });
      setComposerOpen(false);
    } catch (error) {
      console.error("Task creation failed", error);
      alert("Failed to create tasks.");
    } finally {
      setComposerSaving(false);
    }
  }

  if (!userDoc) return null;

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#F7F8FC] px-4 py-8 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_36%),linear-gradient(135deg,_#ffffff,_#f8fafc)] px-5 py-6 sm:px-7">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">Execution Desk</div>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Tasks</h1>
                  <p className="mt-2 max-w-2xl text-sm text-slate-600">Work overdue items first, clear due-today commitments, and manage the next 7 days from one execution surface.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canSeeTeamView ? (
                    <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm shadow-sm">
                      <button type="button" onClick={() => setScopeMode("my")} className={`rounded-full px-4 py-2 font-medium ${scopeMode === "my" ? "bg-slate-900 text-white" : "text-slate-600"}`}>My Queue</button>
                      <button type="button" onClick={() => setScopeMode("team")} className={`rounded-full px-4 py-2 font-medium ${scopeMode === "team" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{isAdminScope ? "Global Queue" : "Team Queue"}</button>
                    </div>
                  ) : null}
                  <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm shadow-sm">
                    <button type="button" onClick={() => setViewMode("list")} className={`rounded-full px-4 py-2 font-medium ${viewMode === "list" ? "bg-slate-900 text-white" : "text-slate-600"}`}>List</button>
                    <button type="button" onClick={() => setViewMode("calendar")} className={`rounded-full px-4 py-2 font-medium ${viewMode === "calendar" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Calendar</button>
                  </div>
                  <button type="button" onClick={() => setComposerOpen(true)} className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"><PlusIcon className="mr-2 h-4 w-4" />Create Task</button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <StatCard label="Active" value={taskStats.active} hint="Open work in this scope." icon={ClipboardDocumentListIcon} />
                <StatCard label="Due Today" value={taskStats.dueToday} hint="Items to clear before day-end." icon={CalendarDaysIcon} />
                <StatCard label="Overdue" value={taskStats.overdue} hint="Needs intervention first." icon={ExclamationTriangleIcon} />
                <StatCard label="Completed" value={taskStats.completed} hint="Closed tasks in this scope." icon={CheckCircleIcon} />
                <StatCard label="Lead Linked" value={taskStats.leadLinked} hint="Tasks tied back to CRM leads." icon={UserGroupIcon} />
                <StatCard label="Link Issues" value={taskStats.linkIssues} hint="Missing leads or owner drift." icon={ExclamationTriangleIcon} />
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full max-w-xl">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by task, category, lead ID, lead name, or tag..." className="w-full rounded-xl border border-slate-200 bg-white px-10 py-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                  {categories.map((category) => <option key={category} value={category}>{category === "all" ? "All Categories" : category}</option>)}
                </select>
                <div className="text-xs font-medium text-slate-500">{filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"} in view</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {QUICK_FILTERS.map((filter) => (
                <button key={filter.id} type="button" onClick={() => setQuickFilter(filter.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${quickFilter === filter.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{filter.label}</button>
              ))}
            </div>

            {viewMode === "list" ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <label className="inline-flex items-center gap-2 font-medium text-slate-700"><input type="checkbox" checked={filteredTasks.length > 0 && selectedTaskIds.length === filteredTasks.length} onChange={toggleVisibleSelection} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />Select visible tasks</label>
                {selectedTaskIds.length > 0 ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-500">{selectedTaskIds.length} selected</span><input type="datetime-local" value={bulkDeadline} onChange={(event) => setBulkDeadline(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" /><button type="button" onClick={() => void bulkReschedule()} disabled={bulkSaving || !bulkDeadline} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Reschedule</button><button type="button" onClick={() => void bulkComplete()} disabled={bulkSaving} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">Complete</button></div> : <span className="text-xs text-slate-500">Bulk actions appear after selection.</span>}
              </div>
            ) : null}
          </section>

          {viewMode === "list" ? (
            <section className="space-y-6">
              {filteredTasks.length === 0 ? (
                <div className="rounded-[30px] border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                  <div className="text-lg font-semibold text-slate-900">No tasks in this queue</div>
                  <div className="mt-2 text-sm text-slate-500">Adjust the quick filter, switch scope, or create a new task.</div>
                </div>
              ) : (
                <>
                  <ListSection title="Overdue" hint="Old commitments that need immediate attention." tasks={groupedTasks.overdue} selectedIds={selectedTaskSet} onToggle={toggleTaskSelection} onOpen={setSelectedTask} userLookup={userLookup} />
                  <ListSection title="Due Today" hint="Today's execution queue for the team." tasks={groupedTasks.due_today} selectedIds={selectedTaskSet} onToggle={toggleTaskSelection} onOpen={setSelectedTask} userLookup={userLookup} />
                  <ListSection title="Upcoming" hint="Scheduled work in the near future." tasks={groupedTasks.upcoming} selectedIds={selectedTaskSet} onToggle={toggleTaskSelection} onOpen={setSelectedTask} userLookup={userLookup} />
                  <ListSection title="No Deadline" hint="Backlog items without a committed date." tasks={groupedTasks.no_deadline} selectedIds={selectedTaskSet} onToggle={toggleTaskSelection} onOpen={setSelectedTask} userLookup={userLookup} />
                  {quickFilter === "completed" ? <ListSection title="Completed" hint="Finished work in this scope." tasks={groupedTasks.completed} selectedIds={selectedTaskSet} onToggle={toggleTaskSelection} onOpen={setSelectedTask} userLookup={userLookup} /> : null}
                </>
              )}
            </section>
          ) : (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Weekly Calendar</div>
                  <div className="mt-1 text-sm text-slate-500">Plan the next 7 days and spot gaps in follow-up coverage.</div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-2">
                  <button type="button" onClick={() => setCalendarAnchor((previous) => addDays(previous, -7))} className="rounded-full p-2 text-slate-600 hover:bg-white"><ChevronLeftIcon className="h-4 w-4" /></button>
                  <div className="px-2 text-sm font-medium text-slate-700">{startOfWeek(calendarAnchor).toLocaleDateString(undefined, { month: "short", day: "numeric" })} - {addDays(startOfWeek(calendarAnchor), 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                  <button type="button" onClick={() => setCalendarAnchor((previous) => addDays(previous, 7))} className="rounded-full p-2 text-slate-600 hover:bg-white"><ChevronRightIcon className="h-4 w-4" /></button>
                </div>
              </div>

              {overdueTasks.length > 0 ? (
                <div className="rounded-[30px] border border-rose-200 bg-rose-50 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-900"><ExclamationTriangleIcon className="h-4 w-4" />Overdue backlog</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {overdueTasks.slice(0, 8).map((task) => <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100">{task.title}</button>)}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-7">
                {calendarDays.map((day) => {
                  const dayTasks = filteredTasks.filter((task) => isTaskOnDay(task, day.date));
                  return (
                    <article key={day.key} className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                      <div className="text-sm font-semibold text-slate-900">{day.label}</div>
                      <div className="mt-3 space-y-3">
                        {dayTasks.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-xs text-slate-500">No scheduled tasks.</div>
                        ) : (
                          dayTasks.map((task) => (
                            <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
                              <div className="text-sm font-semibold text-slate-900">{task.title}</div>
                              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                                <span className={`rounded-full border px-2 py-0.5 ${statusTone(task.status)}`}>{task.status}</span>
                                <span className={`rounded-full border px-2 py-0.5 ${toneForPriority(task.priority)}`}>{task.priority}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {unscheduledTasks.length > 0 ? (
                <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Squares2X2Icon className="h-4 w-4" />Unscheduled backlog</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {unscheduledTasks.map((task) => <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"><div className="text-sm font-semibold text-slate-900">{task.title}</div><div className="mt-1 text-xs text-slate-500">{task.category ?? "General"}</div></button>)}
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>

        <ComposerDrawer
          isOpen={composerOpen}
          onClose={() => setComposerOpen(false)}
          state={composer}
          leadLookup={composerLeadLookup}
          onChange={(patch) => setComposer((previous) => ({ ...previous, ...patch }))}
          onSubmit={() => void createTasks()}
          assigneeOptions={assigneeOptions}
          isSubmitting={composerSaving}
        />

        <TaskDetailDrawer
          task={selectedTask}
          isOpen={selectedTask !== null}
          onClose={() => {
            setSelectedTask(null);
            setCommentText("");
          }}
          comments={comments}
          commentText={commentText}
          onCommentTextChange={setCommentText}
          onAddComment={() => void addComment()}
          isSubmittingComment={commentSaving}
          onStatusChange={(task, status) => void updateTaskStatus(task, status)}
          assigneeLabel={getUserLabel(userLookup.get(selectedTask?.assignedTo ?? selectedTask?.assigneeUid ?? ""))}
        />
      </div>
    </AuthGate>
  );
}
