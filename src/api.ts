import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Scope = "day" | "month";
export type Slot = "work" | "evening" | null;

export interface Task {
  id: number;
  title: string;
  notes: string;
  scope: Scope;
  slot: Slot;
  date: string | null;
  month: string | null;
  done: boolean;
  priority: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskInput {
  id?: number;
  title: string;
  notes: string;
  scope: Scope;
  slot: Slot;
  date: string | null;
  month: string | null;
  priority: number;
  done: boolean;
  /** RFC3339. Omit to let the backend stamp the system clock. */
  completedAt?: string | null;
}

export interface DayCount {
  date: string;
  total: number;
  done: number;
}

export const api = {
  createTask: (input: TaskInput) => invoke<Task>("create_task", { input }),
  updateTask: (input: TaskInput) => invoke<Task>("update_task", { input }),
  setDone: (id: number, done: boolean) => invoke<Task>("set_done", { id, done }),
  deleteTask: (id: number) => invoke<void>("delete_task", { id }),
  reschedule: (id: number, scope: Scope, date: string | null, slot: Slot, month: string | null) =>
    invoke<Task>("reschedule_task", { id, scope, date, slot, month }),

  tasksInRange: (start: string, end: string) => invoke<Task[]>("tasks_in_range", { start, end }),
  tasksInMonth: (month: string) => invoke<Task[]>("tasks_in_month", { month }),
  backlog: (today: string, limit?: number) => invoke<Task[]>("backlog", { today, limit }),
  search: (query: string, limit?: number) => invoke<Task[]>("search_tasks", { query, limit }),
  completed: (limit?: number) => invoke<Task[]>("completed_tasks", { limit }),
  dayCounts: (start: string, end: string) => invoke<DayCount[]>("day_counts", { start, end }),
  dbLocation: () => invoke<string>("db_location"),

  openPlanner: () => invoke<void>("open_planner"),
  closePlanner: () => invoke<void>("close_planner"),
};

/** Fired by the backend after every mutation, in every window. */
export function onTasksChanged(fn: () => void) {
  return listen("tasks-changed", fn);
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
