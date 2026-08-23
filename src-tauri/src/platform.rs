use crate::models::{ClickRef, PlatformInfo, WindowSnapshot};

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::{ffi::c_void, ptr};

    type Hwnd = *mut c_void;

    #[repr(C)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max_count: i32) -> i32;
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
    }

    fn title(hwnd: Hwnd) -> Option<String> {
        if hwnd.is_null() { return None; }
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 { return None; }
        let mut buf = vec![0u16; len as usize + 1];
        let written = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if written <= 0 { return None; }
        Some(String::from_utf16_lossy(&buf[..written as usize]))
    }

    fn rect(hwnd: Hwnd) -> Option<Rect> {
        if hwnd.is_null() { return None; }
        let mut r = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        if unsafe { GetWindowRect(hwnd, &mut r) } == 0 { None } else { Some(r) }
    }

    pub fn foreground() -> WindowSnapshot {
        let hwnd = unsafe { GetForegroundWindow() };
        let r = rect(hwnd);
        WindowSnapshot {
            title: title(hwnd),
            left: r.as_ref().map(|r| r.left),
            top: r.as_ref().map(|r| r.top),
            right: r.as_ref().map(|r| r.right),
            bottom: r.as_ref().map(|r| r.bottom),
        }
    }

    struct FindData {
        needle: String,
        exact: Hwnd,
        partial: Hwnd,
    }

    extern "system" fn enum_cb(hwnd: Hwnd, lparam: isize) -> i32 {
        let data = unsafe { &mut *(lparam as *mut FindData) };
        if unsafe { IsWindowVisible(hwnd) } == 0 { return 1; }
        let Some(t) = title(hwnd) else { return 1; };
        let lower = t.to_lowercase();
        if lower == data.needle {
            data.exact = hwnd;
            return 0;
        }
        if data.partial.is_null() && lower.contains(&data.needle) {
            data.partial = hwnd;
        }
        1
    }

    fn find_window(name: &str) -> Hwnd {
        let mut data = FindData {
            needle: name.trim().to_lowercase(),
            exact: ptr::null_mut(),
            partial: ptr::null_mut(),
        };
        if data.needle.is_empty() { return ptr::null_mut(); }
        unsafe { EnumWindows(enum_cb, (&mut data as *mut FindData) as isize); }
        if !data.exact.is_null() { data.exact } else { data.partial }
    }

    pub fn resolve(action: &ClickRef<'_>, focus: bool) -> (i32, i32) {
        if let (Some(title), Some(rx), Some(ry)) = (action.window_title, action.relative_x, action.relative_y) {
            let hwnd = find_window(title);
            if !hwnd.is_null() {
                if focus { unsafe { SetForegroundWindow(hwnd); } }
                if let Some(r) = rect(hwnd) {
                    return (r.left + rx, r.top + ry);
                }
            }
        }
        (action.screen_x, action.screen_y)
    }

    pub fn retarget(window_title: Option<&str>, x: i32, y: i32) -> (Option<i32>, Option<i32>) {
        let Some(title) = window_title else { return (None, None); };
        let hwnd = find_window(title);
        if hwnd.is_null() { return (None, None); }
        let Some(r) = rect(hwnd) else { return (None, None); };
        (Some(x - r.left), Some(y - r.top))
    }

    pub fn info() -> PlatformInfo {
        PlatformInfo {
            os: "windows".into(),
            physical_mouse_supported: true,
            global_recording_supported: true,
            window_relative_supported: true,
            accessibility_note: None,
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;

    pub fn foreground() -> WindowSnapshot {
        WindowSnapshot::default()
    }

    pub fn resolve(action: &ClickRef<'_>, _focus: bool) -> (i32, i32) {
        // Screen-coordinate playback is shared and works on macOS through Enigo.
        // Window-relative tracking is Windows-first for v2.0.0.
        (action.screen_x, action.screen_y)
    }

    pub fn retarget(_window_title: Option<&str>, _x: i32, _y: i32) -> (Option<i32>, Option<i32>) {
        (None, None)
    }

    pub fn info() -> PlatformInfo {
        #[cfg(target_os = "macos")]
        return PlatformInfo {
            os: "macos".into(),
            physical_mouse_supported: true,
            global_recording_supported: true,
            window_relative_supported: false,
            accessibility_note: Some("Grant FlowClicker Accessibility permission in System Settings → Privacy & Security → Accessibility for global recording and native input.".into()),
        };

        #[cfg(not(target_os = "macos"))]
        PlatformInfo {
            os: std::env::consts::OS.into(),
            physical_mouse_supported: true,
            global_recording_supported: true,
            window_relative_supported: false,
            accessibility_note: None,
        }
    }
}

pub use imp::{foreground, info, resolve, retarget};
