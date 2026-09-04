//! Native window-layer tricks. Everything here is macOS-only; the stubs keep
//! the rest of the app compiling on other platforms.

#[cfg(target_os = "macos")]
mod imp {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};
    use tauri::WebviewWindow;

    /// CGWindowLevelForKey(kCGDesktopWindowLevelKey). Sits below every normal
    /// window *and* below kCGDesktopIconWindowLevel, where Finder draws the
    /// desktop icons — so icons stay on top of the planner, as a wallpaper.
    const DESKTOP_LEVEL: i64 = -2_147_483_623;
    /// NSFloatingWindowLevel.
    const FLOATING_LEVEL: i64 = 3;

    const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const STATIONARY: u64 = 1 << 4;
    const IGNORES_CYCLE: u64 = 1 << 6;

    fn ns_window(window: &WebviewWindow) -> Result<*mut Object, String> {
        let ptr = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
        if ptr.is_null() {
            return Err("window has no backing NSWindow".into());
        }
        Ok(ptr)
    }

    /// Paint this window at the desktop layer: behind all apps, behind the
    /// Finder icons, present on every Space, skipped by Mission Control cycling.
    pub fn pin_to_desktop(window: &WebviewWindow) -> Result<(), String> {
        let ptr = ns_window(window)?;
        unsafe {
            let _: () = msg_send![ptr, setLevel: DESKTOP_LEVEL];
            let _: () = msg_send![
                ptr,
                setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE
            ];
            let _: () = msg_send![ptr, setHidesOnDeactivate: false];
            let _: () = msg_send![ptr, setMovableByWindowBackground: false];
        }
        Ok(())
    }

    /// Keep the launcher pill above ordinary windows and on every Space, so the
    /// way into the planner is always one click away even when the wallpaper
    /// layer is covered by other apps.
    pub fn pin_floating(window: &WebviewWindow) -> Result<(), String> {
        let ptr = ns_window(window)?;
        unsafe {
            let _: () = msg_send![ptr, setLevel: FLOATING_LEVEL];
            let _: () = msg_send![
                ptr,
                setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE
            ];
            let _: () = msg_send![ptr, setHidesOnDeactivate: false];
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::WebviewWindow;

    pub fn pin_to_desktop(_window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
    pub fn pin_floating(_window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::{pin_floating, pin_to_desktop};
