use std::{env, fs, path::PathBuf};

fn state_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base = env::var("APPDATA").map_err(|_| "APPDATA is not available".to_string())?;
        return Ok(PathBuf::from(base).join("FlowClicker"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME").map_err(|_| "HOME is not available".to_string())?;
        return Ok(PathBuf::from(home).join("Library").join("Application Support").join("FlowClicker"));
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

fn state_path() -> Result<PathBuf, String> {
    Ok(state_dir()?.join("state.json"))
}

pub fn load() -> Result<Option<String>, String> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

pub fn save(json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("Refusing to save invalid JSON: {e}"))?;
    let dir = state_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("state.json");
    let tmp = dir.join("state.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).or_else(|_| {
        // Windows cannot always replace an existing file with rename.
        let _ = fs::remove_file(&path);
        fs::rename(&tmp, &path)
    }).map_err(|e| e.to_string())
}
