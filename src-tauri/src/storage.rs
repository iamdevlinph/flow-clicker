use std::{
    env, fs,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
};

fn state_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base = env::var("APPDATA").map_err(|_| "APPDATA is not available".to_string())?;
        return Ok(PathBuf::from(base).join("FlowClicker"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME").map_err(|_| "HOME is not available".to_string())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("FlowClicker"));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = env::var("XDG_CONFIG_HOME") {
            return Ok(PathBuf::from(xdg).join("flowclicker"));
        }
        let home = env::var("HOME").map_err(|_| "HOME is not available".to_string())?;
        Ok(PathBuf::from(home).join(".config").join("flowclicker"))
    }
}

fn valid_json(path: &Path) -> Result<bool, String> {
    match fs::read(path) {
        Ok(json) => Ok(serde_json::from_slice::<serde_json::Value>(&json).is_ok()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn load_from_dir(dir: &Path) -> Result<Option<String>, String> {
    let paths = [
        dir.join("state.json"),
        dir.join("state.json.tmp"),
        dir.join("state.json.bak1"),
        dir.join("state.json.bak2"),
    ];
    let mut present = false;
    let mut read_error = None;
    for path in paths {
        match fs::read_to_string(&path) {
            Ok(json) => {
                present = true;
                if serde_json::from_str::<serde_json::Value>(&json).is_ok() {
                    return Ok(Some(json));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                present = true;
                read_error = Some(format!("{}: {error}", path.display()));
            }
        }
    }
    if present {
        Err(read_error.unwrap_or_else(|| "No valid state file found".to_string()))
    } else {
        Ok(None)
    }
}

fn rotate_backup(dir: &Path) -> Result<(), String> {
    let bak1 = dir.join("state.json.bak1");
    let bak2 = dir.join("state.json.bak2");
    if !valid_json(&bak1)? {
        if bak1.exists() {
            fs::remove_file(&bak1).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    if bak2.exists() {
        fs::remove_file(&bak2).map_err(|e| e.to_string())?;
    }
    fs::rename(bak1, bak2).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn replace_primary(dir: &Path, primary_valid: bool) -> Result<(), String> {
    let primary = dir.join("state.json");
    let tmp = dir.join("state.json.tmp");
    if !primary_valid {
        return fs::rename(tmp, primary).map_err(|e| e.to_string());
    }
    let bak1 = dir.join("state.json.bak1");
    fs::rename(&primary, &bak1).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&tmp, &primary) {
        let _ = fs::rename(&bak1, &primary);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn replace_primary(dir: &Path, primary_valid: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    let primary_path = dir.join("state.json");
    let primary = wide(&primary_path);
    let tmp = wide(&dir.join("state.json.tmp"));
    let bak1 = wide(&dir.join("state.json.bak1"));
    let result = if primary_path.exists() {
        unsafe {
            ReplaceFileW(
                primary.as_ptr(),
                tmp.as_ptr(),
                primary_valid
                    .then_some(bak1.as_ptr())
                    .unwrap_or(std::ptr::null()),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        }
    } else {
        unsafe { MoveFileExW(tmp.as_ptr(), primary.as_ptr(), 1) }
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

fn save_to_dir(json: &str, dir: &Path) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("Refusing to save invalid JSON: {e}"))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let primary = dir.join("state.json");
    let tmp = dir.join("state.json.tmp");
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let primary_valid = valid_json(&primary)?;
    if primary_valid {
        rotate_backup(dir)?;
    }
    replace_primary(dir, primary_valid)
}

pub fn load() -> Result<Option<String>, String> {
    load_from_dir(&state_dir()?)
}
pub fn save(json: &str) -> Result<(), String> {
    save_to_dir(json, &state_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn with_dir(test: impl FnOnce(&Path)) {
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("flowclicker-storage-{stamp}-{id}"));
        fs::create_dir_all(&dir).unwrap();
        test(&dir);
        fs::remove_dir_all(dir).unwrap();
    }
    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }
    #[test]
    fn saves_keep_two_previous_snapshots() {
        with_dir(|dir| {
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json"), r#"{"n":1}"#);
            assert!(!dir.join("state.json.bak1").exists());
            save_to_dir(r#"{"n":2}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json.bak1"), r#"{"n":1}"#);
            save_to_dir(r#"{"n":3}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json.bak1"), r#"{"n":2}"#);
            assert_eq!(read(dir, "state.json.bak2"), r#"{"n":1}"#);
            save_to_dir(r#"{"n":4}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json.bak1"), r#"{"n":3}"#);
            assert_eq!(read(dir, "state.json.bak2"), r#"{"n":2}"#);
        });
    }
    #[test]
    fn load_prefers_newest_valid_candidate_and_skips_corruption() {
        with_dir(|dir| {
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            save_to_dir(r#"{"n":2}"#, dir).unwrap();
            save_to_dir(r#"{"n":3}"#, dir).unwrap();
            fs::write(dir.join("state.json"), b"\0broken").unwrap();
            fs::write(dir.join("state.json.tmp"), r#"{"n":4}"#).unwrap();
            assert_eq!(load_from_dir(dir).unwrap(), Some(r#"{"n":4}"#.to_string()));
            fs::write(dir.join("state.json.tmp"), b"broken").unwrap();
            assert_eq!(load_from_dir(dir).unwrap(), Some(r#"{"n":2}"#.to_string()));
            fs::write(dir.join("state.json.bak1"), b"broken").unwrap();
            assert_eq!(load_from_dir(dir).unwrap(), Some(r#"{"n":1}"#.to_string()));
            fs::write(dir.join("state.json.bak2"), b"broken").unwrap();
            assert!(load_from_dir(dir).is_err());
        });
    }
    #[test]
    fn absent_and_all_invalid_are_distinct() {
        with_dir(|dir| {
            assert_eq!(load_from_dir(dir).unwrap(), None);
            fs::write(dir.join("state.json"), b"broken").unwrap();
            assert!(load_from_dir(dir).is_err());
        });
    }
    #[test]
    fn invalid_save_does_not_touch_existing_state() {
        with_dir(|dir| {
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            assert!(save_to_dir("broken", dir).is_err());
            assert_eq!(read(dir, "state.json"), r#"{"n":1}"#);
        });
    }

    #[test]
    fn malformed_backup_is_discarded_not_rotated() {
        with_dir(|dir| {
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            fs::write(dir.join("state.json.bak1"), b"broken").unwrap();
            save_to_dir(r#"{"n":2}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json.bak1"), r#"{"n":1}"#);
            assert!(!dir.join("state.json.bak2").exists());
        });
    }

    #[test]
    fn unreadable_backup_aborts_without_touching_primary() {
        with_dir(|dir| {
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            fs::create_dir(dir.join("state.json.bak1")).unwrap();
            assert!(save_to_dir(r#"{"n":2}"#, dir).is_err());
            assert_eq!(read(dir, "state.json"), r#"{"n":1}"#);
            assert!(dir.join("state.json.bak1").is_dir());
        });
    }

    #[test]
    fn non_utf8_primary_is_replaced_as_corrupt() {
        with_dir(|dir| {
            fs::write(dir.join("state.json"), [0xff]).unwrap();
            save_to_dir(r#"{"n":1}"#, dir).unwrap();
            assert_eq!(read(dir, "state.json"), r#"{"n":1}"#);
        });
    }
}
