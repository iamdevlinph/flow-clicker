use crate::models::{ClickRef, PlatformInfo, WindowSnapshot, WindowTarget};

pub fn is_flowclicker_title(title: Option<&str>) -> bool {
    title
        .unwrap_or_default()
        .to_lowercase()
        .contains("flowclicker")
}

fn select_candidate(titles: &[Option<String>], recorded_title: &str) -> Result<usize, String> {
    match titles.len() {
        0 => Err("Recorded target window is missing.".into()),
        1 => Ok(0),
        _ => {
            let matching: Vec<_> = titles
                .iter()
                .enumerate()
                .filter(|(_, title)| title.as_deref() == Some(recorded_title))
                .map(|(index, _)| index)
                .collect();
            if matching.len() == 1 {
                Ok(matching[0])
            } else {
                Err("Recorded target window is ambiguous.".into())
            }
        }
    }
}

fn safe_target_point(
    foreground: bool,
    bounds: Option<(i32, i32, i32, i32)>,
    relative_x: Option<i32>,
    relative_y: Option<i32>,
    unobscured: impl FnOnce(i32, i32) -> bool,
) -> Result<(i32, i32), String> {
    if !foreground {
        return Err("Recorded target is not foreground.".into());
    }
    let x = relative_x.ok_or("Click has no relative X coordinate.")?;
    let y = relative_y.ok_or("Click has no relative Y coordinate.")?;
    let (left, top, right, bottom) = bounds.ok_or("Recorded target window is closed.")?;
    if x < 0 || y < 0 || x >= right - left || y >= bottom - top {
        return Err("Click point is outside the target window.".into());
    }
    let point = (left + x, top + y);
    if !unobscured(point.0, point.1) {
        return Err("Click point is obscured by another window.".into());
    }
    Ok(point)
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::{ffi::c_void, ptr};

    type Hwnd = *mut c_void;

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max_count: i32) -> i32;
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn GetClassNameW(hwnd: Hwnd, text: *mut u16, max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
        fn GetAncestor(hwnd: Hwnd, flags: u32) -> Hwnd;
        fn WindowFromPoint(point: Point) -> Hwnd;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Hwnd;
        fn QueryFullProcessImageNameW(
            process: Hwnd,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Hwnd) -> i32;
    }
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const GA_ROOT: u32 = 2;

    fn title(hwnd: Hwnd) -> Option<String> {
        if hwnd.is_null() {
            return None;
        }
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let written = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if written <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..written as usize]))
    }
    fn class_name(hwnd: Hwnd) -> Option<String> {
        let mut buf = vec![0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        (n > 0).then(|| String::from_utf16_lossy(&buf[..n as usize]))
    }
    fn executable_path(hwnd: Hwnd) -> Option<String> {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return None;
        }
        let mut buf = vec![0u16; 1024];
        let mut size = buf.len() as u32;
        let ok =
            unsafe { QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut size) } != 0;
        unsafe {
            CloseHandle(process);
        }
        ok.then(|| String::from_utf16_lossy(&buf[..size as usize]))
    }

    fn rect(hwnd: Hwnd) -> Option<Rect> {
        if hwnd.is_null() {
            return None;
        }
        let mut r = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
            None
        } else {
            Some(r)
        }
    }

    pub fn foreground() -> WindowSnapshot {
        let hwnd = unsafe { GetForegroundWindow() };
        let r = rect(hwnd);
        WindowSnapshot {
            title: title(hwnd),
            executable_path: executable_path(hwnd),
            class_name: class_name(hwnd),
            window_handle: (!hwnd.is_null()).then_some(hwnd as isize as i64),
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
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        let Some(t) = title(hwnd) else {
            return 1;
        };
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
        if data.needle.is_empty() {
            return ptr::null_mut();
        }
        unsafe {
            EnumWindows(enum_cb, (&mut data as *mut FindData) as isize);
        }
        if !data.exact.is_null() {
            data.exact
        } else {
            data.partial
        }
    }

    pub fn resolve(action: &ClickRef<'_>, focus: bool) -> (i32, i32) {
        if let (Some(title), Some(rx), Some(ry)) =
            (action.window_title, action.relative_x, action.relative_y)
        {
            let hwnd = find_window(title);
            if !hwnd.is_null() {
                if focus {
                    unsafe {
                        SetForegroundWindow(hwnd);
                    }
                }
                if let Some(r) = rect(hwnd) {
                    return (r.left + rx, r.top + ry);
                }
            }
        }
        (action.screen_x, action.screen_y)
    }

    struct FindTarget {
        target: WindowTarget,
        matches: Vec<Hwnd>,
    }
    extern "system" fn target_cb(hwnd: Hwnd, lparam: isize) -> i32 {
        let data = unsafe { &mut *(lparam as *mut FindTarget) };
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        if executable_path(hwnd)
            .is_some_and(|path| path.eq_ignore_ascii_case(&data.target.executable_path))
            && class_name(hwnd)
                .is_some_and(|class| class.eq_ignore_ascii_case(&data.target.class_name))
        {
            data.matches.push(hwnd);
        }
        1
    }
    fn find_target(target: &WindowTarget) -> Result<Hwnd, String> {
        let mut data = FindTarget {
            target: target.clone(),
            matches: Vec::new(),
        };
        unsafe {
            EnumWindows(target_cb, (&mut data as *mut FindTarget) as isize);
        }
        let titles: Vec<_> = data.matches.iter().map(|hwnd| title(*hwnd)).collect();
        select_candidate(&titles, &target.title).map(|index| data.matches[index])
    }
    pub type ResolvedTarget = isize;
    pub fn prepare_target(target: &WindowTarget, focus: bool) -> Result<ResolvedTarget, String> {
        if std::env::current_exe()
            .ok()
            .and_then(|path| path.to_str().map(str::to_owned))
            .is_some_and(|path| path.eq_ignore_ascii_case(&target.executable_path))
        {
            return Err("FlowClicker cannot be used as a playback target.".into());
        }
        let hwnd = find_target(target)?;
        if focus {
            unsafe {
                SetForegroundWindow(hwnd);
            }
        }
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err("Recorded target is not foreground.".into());
        }
        Ok(hwnd as isize)
    }
    pub fn resolve_target(
        target: ResolvedTarget,
        action: &ClickRef<'_>,
    ) -> Result<(i32, i32), String> {
        let hwnd = target as Hwnd;
        safe_target_point(
            unsafe { GetForegroundWindow() } == hwnd,
            rect(hwnd).map(|r| (r.left, r.top, r.right, r.bottom)),
            action.relative_x,
            action.relative_y,
            |x, y| unsafe { GetAncestor(WindowFromPoint(Point { x, y }), GA_ROOT) == hwnd },
        )
    }

    pub fn retarget(window_title: Option<&str>, x: i32, y: i32) -> (Option<i32>, Option<i32>) {
        let Some(title) = window_title else {
            return (None, None);
        };
        let hwnd = find_window(title);
        if hwnd.is_null() {
            return (None, None);
        }
        let Some(r) = rect(hwnd) else {
            return (None, None);
        };
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
        // Window-relative tracking is Windows-first for v1.0.0.
        (action.screen_x, action.screen_y)
    }
    pub type ResolvedTarget = isize;
    pub fn prepare_target(_target: &WindowTarget, _focus: bool) -> Result<ResolvedTarget, String> {
        Err("Strict window playback is unavailable on this platform.".into())
    }
    pub fn resolve_target(
        _target: ResolvedTarget,
        _action: &ClickRef<'_>,
    ) -> Result<(i32, i32), String> {
        Err("Strict window playback is unavailable on this platform.".into())
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

pub use imp::{
    foreground, info, prepare_target, resolve, resolve_target, retarget, ResolvedTarget,
};

#[cfg(test)]
mod tests {
    use super::{is_flowclicker_title, safe_target_point, select_candidate};

    #[test]
    fn selects_unique_candidate_even_when_title_changed() {
        assert_eq!(select_candidate(&[Some("New".into())], "Old").unwrap(), 0);
    }

    #[test]
    fn uses_title_only_to_disambiguate() {
        assert_eq!(
            select_candidate(&[Some("Other".into()), Some("Wanted".into())], "Wanted").unwrap(),
            1
        );
        assert!(select_candidate(&[Some("Same".into()), Some("Same".into())], "Same").is_err());
        assert!(select_candidate(&[], "Missing").is_err());
    }

    #[test]
    fn rejects_flowclicker_windows() {
        assert!(is_flowclicker_title(Some("FlowClicker — Editor")));
        assert!(!is_flowclicker_title(Some("Target app")));
    }

    #[test]
    fn rejects_every_unsafe_click_state() {
        let bounds = Some((10, 20, 110, 120));
        assert!(safe_target_point(false, bounds, Some(1), Some(1), |_, _| true).is_err());
        assert!(safe_target_point(true, bounds, None, Some(1), |_, _| true).is_err());
        assert!(safe_target_point(true, None, Some(1), Some(1), |_, _| true).is_err());
        assert!(safe_target_point(true, bounds, Some(100), Some(1), |_, _| true).is_err());
        assert!(safe_target_point(true, bounds, Some(1), Some(1), |_, _| false).is_err());
        assert_eq!(
            safe_target_point(true, bounds, Some(1), Some(2), |_, _| true).unwrap(),
            (11, 22)
        );
    }
}
