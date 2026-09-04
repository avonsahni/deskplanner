import { api, errorText, onTasksChanged, Scope, Slot, Task, TaskInput } from "./api";
import {
  addDays, addMonths, dowLabel, fromYmd, isoOnLocalDate, isWeekend, localDateOfIso,
  longDate, monthLabel, monthShort, relative, shortDate, startOfWeek, today,
  weekLabel, ym, ymd,
} from "./dates";

function need<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const SLOT_LABEL: Record<string, string> = { work: "09:00 – 17:00", evening: "Evening" };

// ------------------------------------------------------------------- state
let weekStart = startOfWeek(today());
let monthKey = ym(today());
let weekTasks: Task[] = [];
let backlogTasks: Task[] = [];
let monthTasks: Task[] = [];
let query = "";
let searchTimer: number | undefined;

// ------------------------------------------------------------------- toast
let toastTimer: number | undefined;
function toast(message: string, bad = false) {
  const el = need("toast");
  el.textContent = message;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, bad ? 4200 : 2000);
}

async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (e) {
    toast(errorText(e), true);
    return undefined;
  }
}

// -------------------------------------------------------------- data loads
async function refresh() {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));
  const loaded = await guard(() =>
    Promise.all([api.tasksInRange(start, end), api.backlog(ymd(today())), api.tasksInMonth(monthKey)]),
  );
  if (!loaded) return;
  [weekTasks, backlogTasks, monthTasks] = loaded;
  renderBoard();
  renderBacklog();
  renderMonth();
  if (query) void runSearch();
  if (!need("history").hidden) void openHistory();
}

// -------------------------------------------------------------------- card
interface CardOpts {
  showDate?: boolean;
  quick?: boolean;
  /** In the history sheet everything is done, so don't grey it all out. */
  history?: boolean;
}

function card(task: Task, opts: CardOpts = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = `card${task.done && !opts.history ? " done" : ""}`;
  el.dataset.id = String(task.id);
  el.dataset.priority = String(task.priority);
  el.draggable = true;
  el.title = task.notes ? task.notes : "Click to edit";

  const check = document.createElement("button");
  check.className = `check${task.done ? " on" : ""}`;
  check.title = task.done ? "Mark as not done" : "Mark as done";
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    void guard(() => api.setDone(task.id, !task.done));
  });

  const body = document.createElement("div");
  body.className = "body";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = task.title;
  body.append(title);

  const meta = document.createElement("div");
  meta.className = "meta";

  if (opts.showDate) {
    const when = document.createElement("span");
    const overdue = !task.done && task.date !== null && task.date < ymd(today());
    when.className = `pill${overdue ? " late" : ""}`;
    when.textContent = task.date
      ? `${shortDate(fromYmd(task.date))} · ${relative(task.date)}`
      : task.month
        ? monthLabel(task.month)
        : "";
    if (when.textContent) meta.append(when);
  }
  // Inside a block the slot is implied by the block itself; only spell it out
  // in the backlog and search results, where there is no surrounding column.
  if (task.slot && opts.showDate) {
    const slot = document.createElement("span");
    slot.className = "pill";
    slot.textContent = SLOT_LABEL[task.slot];
    meta.append(slot);
  }
  if (opts.history) {
    const stamp = task.completedAt ?? task.updatedAt;
    const tick = document.createElement("span");
    tick.className = "pill tick";
    tick.textContent = `✓ ${new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    meta.append(tick);
  }
  if (task.priority === 2) {
    const p = document.createElement("span");
    p.className = "pill late";
    p.textContent = "High";
    meta.append(p);
  }
  if (task.notes) {
    const n = document.createElement("span");
    n.className = "note";
    n.textContent = task.notes.replace(/\s+/g, " ").slice(0, 60);
    meta.append(n);
  }
  if (meta.childElementCount) body.append(meta);

  if (opts.quick && !task.done) {
    const quick = document.createElement("div");
    quick.className = "quick";
    const jump = (label: string, target: Date) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = `Move to ${shortDate(target)}`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const slot = isWeekend(target) ? null : (task.slot ?? "work");
        void guard(() => api.reschedule(task.id, "day", ymd(target), slot, null));
      });
      return b;
    };
    quick.append(jump("→ Today", today()), jump("→ Tomorrow", addDays(today(), 1)));
    quick.addEventListener("click", (e) => e.stopPropagation());
    body.append(quick);
  }

  el.append(check, body);
  el.addEventListener("click", () => openEditor(task));
  el.addEventListener("dragstart", (e) => {
    el.classList.add("dragging");
    e.dataTransfer?.setData("text/plain", String(task.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

function emptyHint(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "empty";
  el.textContent = text;
  return el;
}

// ------------------------------------------------------------ drop targets
interface Target {
  scope: Scope;
  date: string | null;
  slot: Slot;
  month: string | null;
}

function dropTarget(el: HTMLElement, target: Target) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.classList.add("drop");
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove("drop");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    // Lists sit inside blocks and both are drop targets; without this the drop
    // would be handled twice on the way up.
    e.stopPropagation();
    el.classList.remove("drop");
    const id = Number(e.dataTransfer?.getData("text/plain"));
    if (!Number.isFinite(id) || id <= 0) return;
    void guard(() => api.reschedule(id, target.scope, target.date, target.slot, target.month));
  });
}

// ------------------------------------------------------------------- board
/** Lists are rebuilt wholesale on every change; remembering scroll offsets by
 *  key keeps that invisible to anyone mid-scroll. */
const scrollMemory = new Map<string, number>();

function rememberScroll() {
  document.querySelectorAll<HTMLElement>(".list[data-key]").forEach((l) => {
    scrollMemory.set(l.dataset.key as string, l.scrollTop);
  });
}

function list(key: string, target: Target | null, tasks: Task[], opts: CardOpts, empty: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "list";
  el.dataset.key = key;
  if (tasks.length) tasks.forEach((t) => el.append(card(t, opts)));
  else el.append(emptyHint(empty));
  if (target) dropTarget(el, target);
  queueMicrotask(() => { el.scrollTop = scrollMemory.get(key) ?? 0; });
  return el;
}

function block(headLabel: string, dotClass: string, key: string, target: Target, tasks: Task[], empty: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "block";

  const head = document.createElement("div");
  head.className = "block-head";

  const dot = document.createElement("span");
  dot.className = `dot ${dotClass}`;
  const label = document.createElement("span");
  label.textContent = headLabel;

  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "＋";
  add.title = `Add a task to ${headLabel}`;
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditor(null, target);
  });

  head.append(dot, label, add);
  wrap.append(head, list(key, target, tasks, {}, empty));
  dropTarget(wrap, target);
  return wrap;
}

function dayHead(d: Date, open: number): HTMLElement {
  const head = document.createElement("div");
  head.className = "col-head";
  const dow = document.createElement("span");
  dow.className = "dow";
  dow.textContent = dowLabel(d);
  const date = document.createElement("span");
  date.className = "date";
  date.textContent = shortDate(d);
  const tally = document.createElement("span");
  tally.className = "tally";
  tally.textContent = open ? String(open) : "";
  head.append(dow, date, tally);
  return head;
}

function renderBoard() {
  rememberScroll();
  const board = need("board");
  board.textContent = "";
  need("week-label").textContent = weekLabel(weekStart);

  const stamp = ymd(today());
  const byDate = new Map<string, Task[]>();
  for (const t of weekTasks) {
    if (!t.date) continue;
    const bucket = byDate.get(t.date);
    if (bucket) bucket.push(t);
    else byDate.set(t.date, [t]);
  }

  for (let i = 0; i < 5; i++) {
    const d = addDays(weekStart, i);
    const key = ymd(d);
    const dayTasks = byDate.get(key) ?? [];

    const col = document.createElement("div");
    col.className = "col";
    if (key === stamp) col.classList.add("today");
    else if (key < stamp) col.classList.add("past");

    col.append(dayHead(d, dayTasks.length));
    col.append(
      block("Work · 9–5", "", `${key}/work`, { scope: "day", date: key, slot: "work", month: null },
        dayTasks.filter((t) => t.slot !== "evening"), "Nothing booked"),
    );
    col.append(
      block("Evening", "eve", `${key}/evening`, { scope: "day", date: key, slot: "evening", month: null },
        dayTasks.filter((t) => t.slot === "evening"), "Free"),
    );
    board.append(col);
  }

  // Weekend: one highlighted column, both days, no time bifurcation.
  const sat = addDays(weekStart, 5);
  const sun = addDays(weekStart, 6);
  const col = document.createElement("div");
  col.className = "col weekend";
  if (ymd(sat) === stamp || ymd(sun) === stamp) col.classList.add("today");

  const head = document.createElement("div");
  head.className = "col-head";
  const dow = document.createElement("span");
  dow.className = "dow";
  dow.textContent = "Weekend";
  const range = document.createElement("span");
  range.className = "date";
  range.textContent = `${sat.getDate()} – ${shortDate(sun)}`;
  const weekendAll = [...(byDate.get(ymd(sat)) ?? []), ...(byDate.get(ymd(sun)) ?? [])];
  const wt = document.createElement("span");
  wt.className = "tally";
  wt.textContent = weekendAll.length ? String(weekendAll.length) : "";
  head.append(dow, range, wt);
  col.append(head);

  for (const d of [sat, sun]) {
    const key = ymd(d);
    col.append(
      block(`${dowLabel(d)} ${d.getDate()}`, "", `${key}/all`,
        { scope: "day", date: key, slot: null, month: null },
        byDate.get(key) ?? [], "Open"),
    );
  }
  board.append(col);
}

// ----------------------------------------------------------------- backlog
function renderBacklog() {
  rememberScroll();
  need("backlog-count").textContent = String(backlogTasks.length);
  const holder = need("backlog-list").parentElement as HTMLElement;
  const old = need("backlog-list");
  const fresh = list("backlog", null, backlogTasks, { showDate: true, quick: true },
    "Nothing overdue. Clear run.");
  fresh.id = "backlog-list";
  holder.replaceChild(fresh, old);
  need<HTMLButtonElement>("backlog-sweep").disabled = backlogTasks.length === 0;
}

// ------------------------------------------------------------- month panel
function renderMonth() {
  rememberScroll();
  need("month-label").textContent = monthShort(monthKey);
  need("month-count").textContent = String(monthTasks.length);
  const holder = need("month-list").parentElement as HTMLElement;
  const old = need("month-list");
  const fresh = list("month", { scope: "month", date: null, slot: null, month: monthKey },
    monthTasks, {}, "No monthly goals yet — drag a task here, or press ＋.");
  fresh.id = "month-list";
  holder.replaceChild(fresh, old);
}

// ----------------------------------------------------------------- history
function span(cls: string, text: string): HTMLElement {
  const el = document.createElement("span");
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

/** Completed tasks, grouped by the day they were actually finished. */
function historyList(tasks: Task[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "list";
  el.dataset.key = "history";
  if (!tasks.length) {
    el.append(emptyHint("Nothing completed yet. Tick a card and it lands here."));
    return el;
  }
  const dayOf = (t: Task) => localDateOfIso(t.completedAt ?? t.updatedAt);
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(dayOf(t), (counts.get(dayOf(t)) ?? 0) + 1);

  let group = "";
  for (const t of tasks) {
    const key = dayOf(t);
    if (key !== group) {
      group = key;
      const head = document.createElement("div");
      head.className = "group-head";
      head.append(span("", longDate(fromYmd(key))), span("when", relative(key)),
                  span("n", String(counts.get(key) ?? 0)));
      el.append(head);
    }
    el.append(card(t, { showDate: true, history: true }));
  }
  queueMicrotask(() => { el.scrollTop = scrollMemory.get("history") ?? 0; });
  return el;
}

async function openHistory() {
  rememberScroll();
  const found = await guard(() => api.completed());
  if (!found) return;
  need("history").hidden = false;
  need("history-count").textContent = String(found.length);
  const holder = need("history-list").parentElement as HTMLElement;
  const old = need("history-list");
  const fresh = historyList(found);
  fresh.id = "history-list";
  holder.replaceChild(fresh, old);
}

function closeHistory() {
  need("history").hidden = true;
}

// ------------------------------------------------------------------ search
async function runSearch() {
  const found = await guard(() => api.search(query));
  if (!found) return;
  const panel = need("results");
  panel.hidden = false;
  need("results-count").textContent = String(found.length);
  const holder = need("results-list").parentElement as HTMLElement;
  const old = need("results-list");
  const fresh = list("results", null, found, { showDate: true },
    `Nothing matches “${query}”.`);
  fresh.id = "results-list";
  holder.replaceChild(fresh, old);
}

function closeSearch() {
  query = "";
  need<HTMLInputElement>("search").value = "";
  need("search-clear").hidden = true;
  need("results").hidden = true;
}

// ------------------------------------------------------------------ editor
type Draft = TaskInput & { id?: number };

let draft: Draft | null = null;
let deleteArmed = false;

function blankDraft(target?: Target | null): Draft {
  const stamp = target?.date ?? ymd(today());
  return {
    title: "",
    notes: "",
    scope: target?.scope ?? "day",
    slot: target?.slot ?? (isWeekend(fromYmd(stamp)) ? null : "work"),
    date: target?.scope === "month" ? null : stamp,
    month: target?.scope === "month" ? (target.month ?? monthKey) : null,
    priority: 1,
    done: false,
    completedAt: null,
  };
}

function monthOptions(selected: string): void {
  const select = need<HTMLSelectElement>("f-month");
  const base = today();
  const keys = new Set<string>();
  for (let i = -12; i <= 18; i++) keys.add(ym(addMonths(base, i)));
  keys.add(selected);
  select.textContent = "";
  [...keys].sort().forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = monthLabel(k);
    select.append(opt);
  });
  select.value = selected;
}

function segment(id: string, attr: string, value: string) {
  need(id).querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.classList.toggle("on", b.dataset[attr] === value);
  });
}

function syncEditor() {
  if (!draft) return;
  need<HTMLInputElement>("f-title").value = draft.title;
  need<HTMLTextAreaElement>("f-notes").value = draft.notes;
  segment("f-scope", "scope", draft.scope);
  segment("f-priority", "priority", String(draft.priority));

  const isDay = draft.scope === "day";
  need("f-date-wrap").hidden = !isDay;
  need("f-slot-wrap").hidden = !isDay;
  need("f-month-wrap").hidden = isDay;

  if (isDay) {
    const stamp = draft.date ?? ymd(today());
    need<HTMLInputElement>("f-date").value = stamp;
    const weekend = isWeekend(fromYmd(stamp));
    need("f-weekend-hint").hidden = !weekend;
    if (weekend) draft.slot = null;
    need("f-slot").querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.disabled = weekend;
      b.classList.toggle("on", !weekend && b.dataset.slot === draft?.slot);
    });
  } else {
    need("f-weekend-hint").hidden = true;
    monthOptions(draft.month ?? monthKey);
  }

  const doneBtn = need<HTMLButtonElement>("f-done-toggle");
  doneBtn.textContent = draft.done ? "✓ Done" : "Mark done";
  doneBtn.classList.toggle("primary", draft.done);

  // A task planned for Monday but ticked on Thursday is completed Thursday —
  // unless the user says otherwise here.
  need("f-completed-wrap").hidden = !draft.done;
  if (draft.done) {
    need<HTMLInputElement>("f-completed").value =
      localDateOfIso(draft.completedAt ?? new Date().toISOString());
  }

  const del = need<HTMLButtonElement>("f-delete");
  del.hidden = draft.id === undefined;
  del.textContent = deleteArmed ? "Really delete?" : "Delete";

  need("editor-title").textContent = draft.id === undefined ? "New task" : "Edit task";
  need("editor-error").hidden = true;
}

function openEditor(task: Task | null, target?: Target | null) {
  draft = task
    ? {
        id: task.id, title: task.title, notes: task.notes, scope: task.scope,
        slot: task.slot, date: task.date, month: task.month,
        priority: task.priority, done: task.done, completedAt: task.completedAt,
      }
    : blankDraft(target);
  deleteArmed = false;
  need("editor").hidden = false;
  syncEditor();
  const title = need<HTMLInputElement>("f-title");
  title.focus();
  title.select();
}

function closeEditor() {
  draft = null;
  deleteArmed = false;
  need("editor").hidden = true;
}

function showEditorError(message: string) {
  const box = need("editor-error");
  box.textContent = message;
  box.hidden = false;
}

async function saveDraft() {
  if (!draft) return;
  draft.title = need<HTMLInputElement>("f-title").value;
  draft.notes = need<HTMLTextAreaElement>("f-notes").value;
  if (!draft.title.trim()) {
    showEditorError("Give the task a title first.");
    need<HTMLInputElement>("f-title").focus();
    return;
  }
  const payload: TaskInput = { ...draft };
  try {
    if (draft.id === undefined) await api.createTask(payload);
    else await api.updateTask({ ...payload, id: draft.id });
    closeEditor();
  } catch (e) {
    showEditorError(errorText(e));
  }
}

// ------------------------------------------------------------------- wiring
function wire() {
  need("prev-week").addEventListener("click", () => { weekStart = addDays(weekStart, -7); void refresh(); });
  need("next-week").addEventListener("click", () => { weekStart = addDays(weekStart, 7); void refresh(); });
  need("this-week").addEventListener("click", () => {
    weekStart = startOfWeek(today());
    monthKey = ym(today());
    void refresh();
  });
  need("hide-planner").addEventListener("click", () => void guard(() => api.closePlanner()));
  need("new-task").addEventListener("click", () => openEditor(null));
  need("show-completed").addEventListener("click", () => void openHistory());
  need("history-close").addEventListener("click", closeHistory);
  need("history").querySelector(".veil")?.addEventListener("click", closeHistory);

  need("month-prev").addEventListener("click", () => {
    monthKey = ym(addMonths(fromYmd(`${monthKey}-01`), -1));
    void refresh();
  });
  need("month-next").addEventListener("click", () => {
    monthKey = ym(addMonths(fromYmd(`${monthKey}-01`), 1));
    void refresh();
  });
  need("month-add").addEventListener("click", () =>
    openEditor(null, { scope: "month", date: null, slot: null, month: monthKey }));

  // Bulk backlog move, behind a confirm step.
  let sweepArmed = false;
  const sweep = need<HTMLButtonElement>("backlog-sweep");
  sweep.addEventListener("click", async () => {
    if (!backlogTasks.length) return;
    if (!sweepArmed) {
      sweepArmed = true;
      sweep.textContent = `Move ${backlogTasks.length}?`;
      window.setTimeout(() => { sweepArmed = false; sweep.textContent = "⇥ Today"; }, 3500);
      return;
    }
    sweepArmed = false;
    sweep.textContent = "⇥ Today";
    const stamp = ymd(today());
    const slot: Slot = isWeekend(today()) ? null : "work";
    const moved = backlogTasks.length;
    await guard(async () => {
      for (const t of backlogTasks) await api.reschedule(t.id, "day", stamp, slot, null);
    });
    toast(`Moved ${moved} task${moved === 1 ? "" : "s"} to today.`);
  });

  // Search
  const search = need<HTMLInputElement>("search");
  search.addEventListener("input", () => {
    query = search.value.trim();
    need("search-clear").hidden = query.length === 0;
    window.clearTimeout(searchTimer);
    if (!query) { need("results").hidden = true; return; }
    searchTimer = window.setTimeout(() => void runSearch(), 140);
  });
  need("search-clear").addEventListener("click", () => { closeSearch(); search.focus(); });
  need("results-close").addEventListener("click", closeSearch);
  need("results").querySelector(".veil")?.addEventListener("click", closeSearch);

  // Editor
  need("f-cancel").addEventListener("click", closeEditor);
  need("editor-x").addEventListener("click", closeEditor);
  need("f-save").addEventListener("click", () => void saveDraft());
  need("editor").addEventListener("click", (e) => { if (e.target === need("editor")) closeEditor(); });

  need("f-scope").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-scope]");
    if (!b || !draft) return;
    draft.scope = b.dataset.scope as Scope;
    if (draft.scope === "month") draft.month ??= monthKey;
    else draft.date ??= ymd(today());
    syncEditor();
  });
  need("f-slot").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-slot]");
    if (!b || !draft || b.disabled) return;
    const picked = b.dataset.slot as Exclude<Slot, null>;
    draft.slot = draft.slot === picked ? null : picked;
    syncEditor();
  });
  need("f-priority").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-priority]");
    if (!b || !draft) return;
    draft.priority = Number(b.dataset.priority);
    syncEditor();
  });
  need<HTMLInputElement>("f-date").addEventListener("change", (e) => {
    if (!draft) return;
    draft.date = (e.target as HTMLInputElement).value || ymd(today());
    syncEditor();
  });
  need<HTMLSelectElement>("f-month").addEventListener("change", (e) => {
    if (draft) draft.month = (e.target as HTMLSelectElement).value;
  });
  need("f-done-toggle").addEventListener("click", () => {
    if (!draft) return;
    draft.done = !draft.done;
    draft.completedAt = draft.done ? (draft.completedAt ?? new Date().toISOString()) : null;
    syncEditor();
  });
  need<HTMLInputElement>("f-completed").addEventListener("change", (e) => {
    if (!draft) return;
    const picked = (e.target as HTMLInputElement).value;
    draft.completedAt = picked ? isoOnLocalDate(picked) : new Date().toISOString();
  });
  need("f-delete").addEventListener("click", async () => {
    if (!draft?.id) return;
    if (!deleteArmed) { deleteArmed = true; syncEditor(); return; }
    const id = draft.id;
    closeEditor();
    await guard(() => api.deleteTask(id));
    toast("Task deleted.");
  });
  need("f-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void saveDraft(); }
  });

  // Shortcuts
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      || e.target instanceof HTMLSelectElement;

    if (e.key === "Escape") {
      if (!need("editor").hidden) closeEditor();
      else if (!need("results").hidden) closeSearch();
      else if (!need("history").hidden) closeHistory();
      else if (typing) (e.target as HTMLElement).blur();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      search.focus();
      search.select();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !need("editor").hidden) {
      e.preventDefault();
      void saveDraft();
      return;
    }
    if (typing || !need("editor").hidden) return;

    switch (e.key) {
      case "ArrowLeft": weekStart = addDays(weekStart, -7); void refresh(); break;
      case "ArrowRight": weekStart = addDays(weekStart, 7); void refresh(); break;
      case "t": case "T":
        weekStart = startOfWeek(today());
        monthKey = ym(today());
        void refresh();
        break;
      case "n": case "N": e.preventDefault(); openEditor(null); break;
      case "d": case "D": e.preventDefault(); void openHistory(); break;
      case "/": e.preventDefault(); search.focus(); break;
    }
  });
}

// --------------------------------------------------------------------- boot
wire();
void refresh();
void onTasksChanged(() => void refresh());

// Roll the "today" highlight over at midnight without a restart.
let lastStamp = ymd(today());
window.setInterval(() => {
  const now = ymd(today());
  if (now !== lastStamp) { lastStamp = now; void refresh(); }
}, 60_000);
