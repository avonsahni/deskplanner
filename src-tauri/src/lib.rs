mod db;
mod platform;

use db::{DayCount, Db, Task, TaskInput};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// Margin between the launcher pill and the bottom-right screen corner, in
/// logical pixels.
const LAUNCHER_MARGIN: f64 = 28.0;

/// Run one query against the shared connection. Taking a closure keeps the
/// guard's lifetime inside this function, so it is always dropped before a
/// command goes on to broadcast.
fn with_db<T>(db: &State<'_, Db>, work: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = db.0.lock().map_err(|_| "Database lock was poisoned.".to_string())?;
    work(&conn)
}

/// Tell every window the dataset moved, so the wallpaper redraws without
/// polling.
fn broadcast(app: &AppHandle) {
    let _ = app.emit("tasks-changed", ());
}

// ---------------------------------------------------------------- task CRUD

#[tauri::command]
fn create_task(app: AppHandle, db: State<Db>, input: TaskInput) -> Result<Task, String> {
    let task = with_db(&db, |c| db::create(c, input))?;
    broadcast(&app);
    Ok(task)
}

#[tauri::command]
fn update_task(app: AppHandle, db: State<Db>, input: TaskInput) -> Result<Task, String> {
    let task = with_db(&db, |c| db::update(c, input))?;
    broadcast(&app);
    Ok(task)
}

#[tauri::command]
fn set_done(app: AppHandle, db: State<Db>, id: i64, done: bool) -> Result<Task, String> {
    let task = with_db(&db, |c| db::set_done(c, id, done))?;
    broadcast(&app);
    Ok(task)
}

#[tauri::command]
fn reschedule_task(
    app: AppHandle,
    db: State<Db>,
    id: i64,
    scope: String,
    date: Option<String>,
    slot: Option<String>,
    month: Option<String>,
) -> Result<Task, String> {
    let task = with_db(&db, |c| db::reschedule(c, id, &scope, date, slot, month))?;
    broadcast(&app);
    Ok(task)
}

#[tauri::command]
fn delete_task(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    with_db(&db, |c| db::delete(c, id))?;
    broadcast(&app);
    Ok(())
}

// ------------------------------------------------------------------ queries

#[tauri::command]
fn tasks_in_range(db: State<Db>, start: String, end: String) -> Result<Vec<Task>, String> {
    with_db(&db, |c| db::in_range(c, &start, &end))
}

#[tauri::command]
fn tasks_in_month(db: State<Db>, month: String) -> Result<Vec<Task>, String> {
    with_db(&db, |c| db::in_month(c, &month))
}

#[tauri::command]
fn backlog(db: State<Db>, today: String, limit: Option<i64>) -> Result<Vec<Task>, String> {
    with_db(&db, |c| db::backlog(c, &today, limit.unwrap_or(200)))
}

#[tauri::command]
fn completed_tasks(db: State<Db>, limit: Option<i64>) -> Result<Vec<Task>, String> {
    with_db(&db, |c| db::completed(c, limit.unwrap_or(500)))
}

#[tauri::command]
fn search_tasks(db: State<Db>, query: String, limit: Option<i64>) -> Result<Vec<Task>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    with_db(&db, |c| db::search(c, &query, limit.unwrap_or(200)))
}

#[tauri::command]
fn day_counts(db: State<Db>, start: String, end: String) -> Result<Vec<DayCount>, String> {
    with_db(&db, |c| db::day_counts(c, &start, &end))
}

#[tauri::command]
fn db_location(app: AppHandle) -> Result<String, String> {
    Ok(data_file(&app)?.to_string_lossy().to_string())
}

// ------------------------------------------------------------------ windows

#[tauri::command]
fn open_planner(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("planner") {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(launcher) = app.get_webview_window("launcher") {
        let _ = launcher.hide();
    }
    Ok(())
}

#[tauri::command]
fn close_planner(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("planner") {
        window.hide().map_err(|e| e.to_string())?;
    }
    if let Some(launcher) = app.get_webview_window("launcher") {
        let _ = launcher.show();
    }
    Ok(())
}

fn data_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("planner.sqlite3"))
}

/// Stretch the wallpaper window over the whole primary display and drop it to
/// the desktop layer; park the launcher pill in the bottom-right corner.
fn place_windows(app: &AppHandle) {
    let wallpaper = app.get_webview_window("wallpaper");
    let launcher = app.get_webview_window("launcher");

    let monitor = wallpaper
        .as_ref()
        .and_then(|w| w.primary_monitor().ok().flatten())
        .or_else(|| launcher.as_ref().and_then(|w| w.primary_monitor().ok().flatten()));

    if let Some(window) = &wallpaper {
        if let Some(monitor) = &monitor {
            let _ = window.set_position(*monitor.position());
            let _ = window.set_size(*monitor.size());
        }
        if let Err(e) = platform::pin_to_desktop(window) {
            eprintln!("planner: could not pin the wallpaper to the desktop layer: {e}");
        }
    }

    if let Some(window) = &launcher {
        if let Some(monitor) = &monitor {
            let scale = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(scale);
            let pos = monitor.position().to_logical::<f64>(scale);
            if let Ok(pill) = window.outer_size() {
                let pill = pill.to_logical::<f64>(scale);
                let x = pos.x + size.width - pill.width - LAUNCHER_MARGIN;
                let y = pos.y + size.height - pill.height - LAUNCHER_MARGIN;
                let _ = window.set_position(tauri::LogicalPosition::new(x, y));
            }
        }
        if let Err(e) = platform::pin_floating(window) {
            eprintln!("planner: could not float the launcher: {e}");
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let path = data_file(&handle)?;
            let conn = db::open(&path)?;
            app.manage(Db(std::sync::Mutex::new(conn)));
            place_windows(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // The planner window is a view onto an always-running app: closing
            // it should put it away, not quit and take the wallpaper with it.
            if window.label() == "planner" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(launcher) = window.app_handle().get_webview_window("launcher") {
                        let _ = launcher.show();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            create_task,
            update_task,
            set_done,
            reschedule_task,
            delete_task,
            tasks_in_range,
            tasks_in_month,
            backlog,
            search_tasks,
            completed_tasks,
            day_counts,
            db_location,
            open_planner,
            close_planner,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the planner");
}
