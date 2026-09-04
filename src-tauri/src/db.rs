use chrono::Utc;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// SQLite handle shared across commands. One connection, guarded by a mutex:
/// a single-user planner never has enough concurrency to justify a pool.
pub struct Db(pub Mutex<Connection>);

pub type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    notes        TEXT    NOT NULL DEFAULT '',
    scope        TEXT    NOT NULL CHECK (scope IN ('day', 'month')),
    slot         TEXT             CHECK (slot IS NULL OR slot IN ('work', 'evening')),
    date         TEXT,
    month        TEXT,
    done         INTEGER NOT NULL DEFAULT 0,
    priority     INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_date  ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_tasks_month ON tasks(month);
CREATE INDEX IF NOT EXISTS idx_tasks_open  ON tasks(done, date);
CREATE INDEX IF NOT EXISTS idx_tasks_title ON tasks(title);
"#;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub scope: String,
    pub slot: Option<String>,
    pub date: Option<String>,
    pub month: Option<String>,
    pub done: bool,
    pub priority: i64,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

const COLS: &str = "id, title, notes, scope, slot, date, month, done, priority, sort_order, created_at, updated_at, completed_at";

fn to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        scope: row.get(3)?,
        slot: row.get(4)?,
        date: row.get(5)?,
        month: row.get(6)?,
        done: row.get::<_, i64>(7)? != 0,
        priority: row.get(8)?,
        sort_order: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

fn query(conn: &Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> Res<Vec<Task>> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let rows = stmt.query_map(p, to_task).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

fn one(conn: &Connection, id: i64) -> Res<Task> {
    let sql = format!("SELECT {COLS} FROM tasks WHERE id = ?1");
    conn.query_row(&sql, params![id], to_task).map_err(err)
}

/// Input shared by create and update. `scope` decides which of
/// date/slot/month survive normalisation, so the frontend never has to
/// clear the fields it isn't using.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub scope: String,
    pub slot: Option<String>,
    pub date: Option<String>,
    pub month: Option<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub done: bool,
    /// When the work actually happened. Absent means "use the system clock" —
    /// a task planned for Monday and ticked on Thursday is completed Thursday.
    #[serde(default)]
    pub completed_at: Option<String>,
}

struct Normalised {
    scope: String,
    slot: Option<String>,
    date: Option<String>,
    month: Option<String>,
}

fn normalise(input: &TaskInput) -> Res<Normalised> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("A task needs a title.".into());
    }
    match input.scope.as_str() {
        "day" => {
            let date = input
                .date
                .clone()
                .filter(|d| d.len() == 10)
                .ok_or("A day task needs a date (YYYY-MM-DD).")?;
            let slot = match input.slot.as_deref() {
                Some("work") => Some("work".to_string()),
                Some("evening") => Some("evening".to_string()),
                _ => None,
            };
            Ok(Normalised { scope: "day".into(), slot, date: Some(date), month: None })
        }
        "month" => {
            let month = input
                .month
                .clone()
                .filter(|m| m.len() == 7)
                .ok_or("A monthly task needs a month (YYYY-MM).")?;
            Ok(Normalised { scope: "month".into(), slot: None, date: None, month: Some(month) })
        }
        other => Err(format!("Unknown scope '{other}'.")),
    }
}

fn next_sort_order(conn: &Connection, n: &Normalised) -> i64 {
    let sql = "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks
               WHERE scope = ?1
                 AND IFNULL(date, '')  = IFNULL(?2, '')
                 AND IFNULL(month, '') = IFNULL(?3, '')
                 AND IFNULL(slot, '')  = IFNULL(?4, '')";
    conn.query_row(sql, params![n.scope, n.date, n.month, n.slot], |r| r.get(0))
        .unwrap_or(1)
}

pub fn create(conn: &Connection, input: TaskInput) -> Res<Task> {
    let n = normalise(&input)?;
    let ts = now();
    let order = next_sort_order(conn, &n);
    let completed = if input.done {
        Some(input.completed_at.clone().unwrap_or_else(|| ts.clone()))
    } else {
        None
    };
    conn.execute(
        "INSERT INTO tasks (title, notes, scope, slot, date, month, done, priority, sort_order, created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)",
        params![
            input.title.trim(),
            input.notes.trim(),
            n.scope,
            n.slot,
            n.date,
            n.month,
            input.done as i64,
            input.priority,
            order,
            ts,
            completed
        ],
    )
    .map_err(err)?;
    one(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, input: TaskInput) -> Res<Task> {
    let id = input.id.ok_or("Missing task id.")?;
    let n = normalise(&input)?;
    let ts = now();
    let changed = conn
        .execute(
            "UPDATE tasks SET title = ?2, notes = ?3, scope = ?4, slot = ?5, date = ?6,
                              month = ?7, priority = ?8, done = ?9, updated_at = ?10,
                              -- an explicit date wins; otherwise keep what is
                              -- there; otherwise stamp the system clock
                              completed_at = CASE WHEN ?9 = 1 THEN COALESCE(?11, completed_at, ?10) ELSE NULL END
             WHERE id = ?1",
            params![
                id,
                input.title.trim(),
                input.notes.trim(),
                n.scope,
                n.slot,
                n.date,
                n.month,
                input.priority,
                input.done as i64,
                ts,
                input.completed_at
            ],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(format!("No task with id {id}."));
    }
    one(conn, id)
}

pub fn set_done(conn: &Connection, id: i64, done: bool) -> Res<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET done = ?2, updated_at = ?3,
                          completed_at = CASE WHEN ?2 = 1 THEN ?3 ELSE NULL END
         WHERE id = ?1",
        params![id, done as i64, ts],
    )
    .map_err(err)?;
    one(conn, id)
}

/// Drag-and-drop target: move a task to another day/slot, or onto a month.
pub fn reschedule(
    conn: &Connection,
    id: i64,
    scope: &str,
    date: Option<String>,
    slot: Option<String>,
    month: Option<String>,
) -> Res<Task> {
    let existing = one(conn, id)?;
    let input = TaskInput {
        id: Some(id),
        title: existing.title,
        notes: existing.notes,
        scope: scope.to_string(),
        slot,
        date,
        month,
        priority: existing.priority,
        done: existing.done,
        completed_at: existing.completed_at,
    };
    update(conn, input)
}

pub fn delete(conn: &Connection, id: i64) -> Res<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

pub fn in_range(conn: &Connection, start: &str, end: &str) -> Res<Vec<Task>> {
    query(
        conn,
        &format!(
            "SELECT {COLS} FROM tasks
             WHERE scope = 'day' AND done = 0 AND date >= ?1 AND date <= ?2
             ORDER BY priority DESC, sort_order ASC, id ASC"
        ),
        params![start, end],
    )
}

pub fn in_month(conn: &Connection, month: &str) -> Res<Vec<Task>> {
    query(
        conn,
        &format!(
            "SELECT {COLS} FROM tasks
             WHERE scope = 'month' AND done = 0 AND month = ?1
             ORDER BY priority DESC, sort_order ASC, id ASC"
        ),
        params![month],
    )
}

/// Everything still open with a date strictly before `today` — the backlog.
pub fn backlog(conn: &Connection, today: &str, limit: i64) -> Res<Vec<Task>> {
    query(
        conn,
        &format!(
            "SELECT {COLS} FROM tasks
             WHERE done = 0 AND scope = 'day' AND date < ?1
             ORDER BY priority DESC, date ASC, sort_order ASC
             LIMIT ?2"
        ),
        params![today, limit],
    )
}

/// Everything ticked off, most recently completed first. `completed_at` can be
/// NULL for rows written before it was tracked, so fall back to `updated_at`.
pub fn completed(conn: &Connection, limit: i64) -> Res<Vec<Task>> {
    query(
        conn,
        &format!(
            "SELECT {COLS} FROM tasks
             WHERE done = 1
             ORDER BY COALESCE(completed_at, updated_at) DESC, id DESC
             LIMIT ?1"
        ),
        params![limit],
    )
}

pub fn search(conn: &Connection, q: &str, limit: i64) -> Res<Vec<Task>> {
    // LIKE's own wildcards have to be neutralised, or searching for "50%"
    // quietly matches everything beginning "50".
    let escaped = q
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let needle = format!("%{escaped}%");
    query(
        conn,
        &format!(
            "SELECT {COLS} FROM tasks
             WHERE title LIKE ?1 ESCAPE '\\' OR notes LIKE ?1 ESCAPE '\\'
             ORDER BY done ASC, COALESCE(date, month || '-01') DESC, id DESC
             LIMIT ?2"
        ),
        params![needle, limit],
    )
}

/// Per-day open/done tallies, used to dot the month strip and the wallpaper.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub date: String,
    pub total: i64,
    pub done: i64,
}

pub fn day_counts(conn: &Connection, start: &str, end: &str) -> Res<Vec<DayCount>> {
    let mut stmt = conn
        .prepare(
            "SELECT date, COUNT(*), SUM(done) FROM tasks
             WHERE scope = 'day' AND date >= ?1 AND date <= ?2
             GROUP BY date ORDER BY date",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![start, end], |r| {
            Ok(DayCount { date: r.get(0)?, total: r.get(1)?, done: r.get::<_, Option<i64>>(2)?.unwrap_or(0) })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}
