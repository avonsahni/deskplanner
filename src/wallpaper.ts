import { api, errorText, onTasksChanged, Task } from "./api";
import { addDays, dowLabel, monthLabel, shortDate, startOfWeek, today, weekLabel, ym, ymd } from "./dates";

/** Read-only week board painted onto the desktop. Deliberately dumb: no
 *  interaction, no drag targets, nothing that could swallow a desktop click. */

const PER_SECTION = 8;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function items(parent: HTMLElement, tasks: Task[], stamp: string, cap = PER_SECTION) {
  const box = el("div", "wall-items");
  if (!tasks.length) {
    box.append(el("div", "wall-empty", "—"));
    parent.append(box);
    return;
  }
  for (const t of tasks.slice(0, cap)) {
    const overdue = !t.done && t.date !== null && t.date < stamp;
    const row = el("div", `wall-item${t.done ? " done" : ""}${overdue ? " late" : ""}`);
    row.append(el("span", "bullet"), el("span", "", t.title));
    box.append(row);
  }
  parent.append(box);
  if (tasks.length > cap) parent.append(el("div", "wall-more", `+${tasks.length - cap} more`));
}

function section(parent: HTMLElement, label: string, tasks: Task[], stamp: string, cap?: number) {
  parent.append(el("div", "wall-sec", label));
  items(parent, tasks, stamp, cap);
}

async function render() {
  const wall = document.getElementById("wall");
  if (!wall) return;

  const weekStart = startOfWeek(today());
  const stamp = ymd(today());
  const monthKey = ym(today());

  let week: Task[], back: Task[], month: Task[];
  let counts: { total: number; done: number }[];
  try {
    [week, back, month, counts] = await Promise.all([
      api.tasksInRange(ymd(weekStart), ymd(addDays(weekStart, 6))),
      api.backlog(stamp, 12),
      api.tasksInMonth(monthKey),
      api.dayCounts(ymd(weekStart), ymd(addDays(weekStart, 6))),
    ]);
  } catch (e) {
    wall.textContent = "";
    wall.append(el("div", "wall-empty", errorText(e)));
    return;
  }

  const byDate = new Map<string, Task[]>();
  for (const t of week) {
    if (!t.date) continue;
    const b = byDate.get(t.date);
    if (b) b.push(t);
    else byDate.set(t.date, [t]);
  }

  wall.textContent = "";

  // ---- header
  const top = el("div", "wall-top");
  const heading = el("h1");
  heading.append(document.createTextNode("Week of "));
  const strong = document.createElement("b");
  strong.textContent = weekLabel(weekStart);
  heading.append(strong);
  const now = today();
  top.append(heading, el("div", "sub", `${dowLabel(now)} ${shortDate(now)}`));

  const open = week.length;
  const done = counts.reduce((n, c) => n + c.done, 0);
  const stat = el("div", "stat");
  const cell = (value: string, label: string, cls = "") => {
    const c = el("div", cls);
    const b = document.createElement("b");
    b.textContent = value;
    c.append(b, document.createTextNode(label));
    return c;
  };
  stat.append(cell(String(open), "open this week"), cell(String(done), "done"),
    cell(String(back.length), "in backlog", "late"));
  top.append(stat);
  wall.append(top);

  // First run shows an empty grid, which tells a new user nothing about how to
  // get in. The row is always present so the grid template stays stable.
  const hint = el("div", "wall-hint");
  if (!week.length && !back.length && !month.length) {
    hint.append(
      el("b", "", "Nothing planned yet."),
      document.createTextNode(" Click the "),
      el("span", "kbd", "Planner"),
      document.createTextNode(" pill in the bottom-right corner, then press "),
      el("span", "kbd", "N"),
      document.createTextNode(" to add your first task."),
    );
  }
  wall.append(hint);

  // ---- week grid
  const grid = el("div", "wall-grid");
  for (let i = 0; i < 5; i++) {
    const d = addDays(weekStart, i);
    const key = ymd(d);
    const dayTasks = byDate.get(key) ?? [];
    const col = el("div", `wall-col${key === stamp ? " today" : ""}`);
    const h = el("h3");
    h.append(document.createTextNode(dowLabel(d)), el("span", "", shortDate(d)));
    col.append(h);
    section(col, "9 – 5", dayTasks.filter((t) => t.slot !== "evening"), stamp, 6);
    section(col, "Evening", dayTasks.filter((t) => t.slot === "evening"), stamp, 4);
    grid.append(col);
  }

  const sat = addDays(weekStart, 5);
  const sun = addDays(weekStart, 6);
  const wknd = el("div", `wall-col weekend${ymd(sat) === stamp || ymd(sun) === stamp ? " today" : ""}`);
  const wh = el("h3");
  wh.append(document.createTextNode("Weekend"), el("span", "", `${sat.getDate()} – ${shortDate(sun)}`));
  wknd.append(wh);
  for (const d of [sat, sun]) {
    section(wknd, `${dowLabel(d)} ${d.getDate()}`, byDate.get(ymd(d)) ?? [], stamp, 5);
  }
  grid.append(wknd);

  // ---- backlog + monthly
  const stack = el("div", "wall-stack");

  const backCol = el("div", "wall-col side backlog");
  const bh = el("h3");
  bh.append(document.createTextNode("Backlog"), el("span", "", `${back.length} open`));
  backCol.append(bh);
  items(backCol, back, stamp, 7);
  stack.append(backCol);

  const monthCol = el("div", "wall-col side");
  const mh = el("h3");
  mh.append(document.createTextNode("Monthly"), el("span", "", monthLabel(monthKey)));
  monthCol.append(mh);
  items(monthCol, month, stamp, 7);
  stack.append(monthCol);

  grid.append(stack);
  wall.append(grid);
}

void render();
void onTasksChanged(() => void render());

// Repaint on the hour so the date and "today" column stay honest.
let lastStamp = ymd(today());
window.setInterval(() => {
  const now = ymd(today());
  if (now !== lastStamp) {
    lastStamp = now;
    void render();
  }
}, 60_000);

// Keep the board sized to the display if the resolution changes.
window.addEventListener("resize", () => void render());

// Guard against a stale board: a date string is cheap to re-derive, but the
// task data itself is only pushed, so re-pull every 15 minutes as a backstop.
window.setInterval(() => void render(), 15 * 60_000);

export {};
