import { api, errorText, onTasksChanged } from "./api";
import { today, ymd } from "./dates";

/** The always-floating pill. Its only jobs: open the planner, and show how
 *  much is still outstanding today. */

const button = document.getElementById("open") as HTMLButtonElement | null;
const badge = document.getElementById("badge") as HTMLElement | null;

button?.addEventListener("click", async () => {
  try {
    await api.openPlanner();
  } catch (e) {
    console.error("could not open the planner:", errorText(e));
  }
});

async function refreshBadge() {
  if (!badge) return;
  try {
    const stamp = ymd(today());
    const [dayTasks, back] = await Promise.all([
      api.tasksInRange(stamp, stamp),
      api.backlog(stamp, 200),
    ]);
    const outstanding = dayTasks.filter((t) => !t.done).length + back.length;
    badge.textContent = String(outstanding);
    badge.hidden = outstanding === 0;
  } catch {
    badge.hidden = true;
  }
}

void refreshBadge();
void onTasksChanged(() => void refreshBadge());
window.setInterval(() => void refreshBadge(), 5 * 60_000);

export {};
