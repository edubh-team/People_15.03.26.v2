import type { Timestamp } from "firebase/firestore";
import { normalizeTaskDoc, type TaskLeadIntegrityState } from "@/lib/tasks/model";

export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskPriority = "high" | "medium" | "low";
export type TaskQuickFilter =
  | "all_active"
  | "due_today"
  | "overdue"
  | "upcoming"
  | "completed"
  | "lead_linked"
  | "link_issues";
export type TaskBucketId =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "no_deadline"
  | "completed";

export type TaskDoc = {
  id: string;
  title: string;
  description: string;
  assignedTo: string | null;
  assigneeUid?: string | null;
  assignedBy?: string | null;
  createdBy?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: unknown;
  updatedAt?: unknown;
  completedAt: unknown | null;
  deadline?: unknown | null;
  category?: string;
  tags?: string[];
  attachments?: string[];
  leadId?: string | null;
  leadName?: string | null;
  leadStatus?: string | null;
  leadOwnerUid?: string | null;
  leadIntegrityState?: TaskLeadIntegrityState;
};

export type CalendarDay = {
  key: string;
  label: string;
  date: Date;
};

export function toDate(value: unknown) {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as Timestamp).toDate();
  }
  if (typeof value === "object" && "seconds" in value && typeof (value as { seconds: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return new Date(value as string | number);
}

export function normalizeWorkbenchTask(task: Record<string, unknown>, fallbackId?: string) {
  return normalizeTaskDoc(task, fallbackId) as TaskDoc;
}

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + 1);
  next.setMilliseconds(-1);
  return next;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

export function getTaskDeadline(task: TaskDoc) {
  return task.deadline ? toDate(task.deadline) : null;
}

export function isTaskCompleted(task: TaskDoc) {
  return task.status === "completed";
}

export function isTaskOverdue(task: TaskDoc, now = new Date()) {
  const deadline = getTaskDeadline(task);
  return Boolean(deadline && deadline.getTime() < startOfDay(now).getTime() && !isTaskCompleted(task));
}

export function isTaskDueToday(task: TaskDoc, now = new Date()) {
  const deadline = getTaskDeadline(task);
  if (!deadline || isTaskCompleted(task)) return false;
  return startOfDay(deadline).getTime() === startOfDay(now).getTime();
}

export function isTaskUpcoming(task: TaskDoc, now = new Date(), days = 7) {
  const deadline = getTaskDeadline(task);
  if (!deadline || isTaskCompleted(task)) return false;
  const dayStart = startOfDay(now).getTime();
  const futureEnd = endOfDay(addDays(now, days)).getTime();
  return deadline.getTime() > endOfDay(now).getTime() && deadline.getTime() <= futureEnd && deadline.getTime() >= dayStart;
}

export function getTaskBucket(task: TaskDoc, now = new Date()): TaskBucketId {
  if (isTaskCompleted(task)) return "completed";
  if (isTaskOverdue(task, now)) return "overdue";
  if (isTaskDueToday(task, now)) return "due_today";
  if (getTaskDeadline(task)) return "upcoming";
  return "no_deadline";
}

export function sortTasks(tasks: TaskDoc[]) {
  return [...tasks].sort((left, right) => {
    const leftDeadline = getTaskDeadline(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDeadline = getTaskDeadline(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;

    const priorityWeight = { high: 0, medium: 1, low: 2 } as const;
    const leftPriority = priorityWeight[left.priority] ?? 3;
    const rightPriority = priorityWeight[right.priority] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return toDate(right.createdAt).getTime() - toDate(left.createdAt).getTime();
  });
}

export function buildTaskStats(tasks: TaskDoc[], now = new Date()) {
  return {
    total: tasks.length,
    active: tasks.filter((task) => !isTaskCompleted(task)).length,
    overdue: tasks.filter((task) => isTaskOverdue(task, now)).length,
    dueToday: tasks.filter((task) => isTaskDueToday(task, now)).length,
    completed: tasks.filter((task) => isTaskCompleted(task)).length,
    leadLinked: tasks.filter((task) => Boolean(task.leadId)).length,
    linkIssues: tasks.filter((task) => task.leadIntegrityState === "orphaned" || task.leadIntegrityState === "owner_mismatch").length,
  };
}

export function filterTasks(tasks: TaskDoc[], input: {
  quickFilter: TaskQuickFilter;
  searchTerm: string;
  category: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const needle = input.searchTerm.trim().toLowerCase();
  const category = input.category.trim().toLowerCase();

  return sortTasks(
    tasks.filter((task) => {
      if (input.quickFilter === "all_active" && isTaskCompleted(task)) return false;
      if (input.quickFilter === "due_today" && !isTaskDueToday(task, now)) return false;
      if (input.quickFilter === "overdue" && !isTaskOverdue(task, now)) return false;
      if (input.quickFilter === "upcoming" && !isTaskUpcoming(task, now)) return false;
      if (input.quickFilter === "completed" && !isTaskCompleted(task)) return false;
      if (input.quickFilter === "lead_linked" && !task.leadId) return false;
      if (input.quickFilter === "link_issues" && task.leadIntegrityState !== "orphaned" && task.leadIntegrityState !== "owner_mismatch") return false;

      if (category !== "all" && (task.category ?? "").trim().toLowerCase() !== category) return false;

      if (!needle) return true;
      const haystack = [
        task.title,
        task.description,
        task.id,
        task.category ?? "",
        task.leadId ?? "",
        task.leadName ?? "",
        ...(task.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }),
  );
}

export function groupTasksByBucket(tasks: TaskDoc[], now = new Date()) {
  const buckets: Record<TaskBucketId, TaskDoc[]> = {
    overdue: [],
    due_today: [],
    upcoming: [],
    no_deadline: [],
    completed: [],
  };

  tasks.forEach((task) => {
    buckets[getTaskBucket(task, now)].push(task);
  });

  return buckets;
}

export function getCalendarDays(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      date,
    } satisfies CalendarDay;
  });
}

export function isTaskOnDay(task: TaskDoc, day: Date) {
  const deadline = getTaskDeadline(task);
  if (!deadline) return false;
  return startOfDay(deadline).getTime() === startOfDay(day).getTime();
}
