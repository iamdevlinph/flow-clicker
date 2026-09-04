#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::{Emitter, Manager, State as TauriState, Webview};
use tauri_plugin_dialog::DialogExt;
#[path = "../../../../src-tauri/src/activity_badge.rs"]
mod activity_badge;
mod browser_actions;
mod contracts;
#[path = "../../../../src-tauri/src/storage.rs"]
mod storage;
use contracts::*;

fn control_only(window: &Webview) -> Result<(), String> {
    (window.label() == CONTROL)
        .then_some(())
        .ok_or_else(|| "Only the control window may invoke this command".into())
}

fn control_or_overlay(window: &Webview) -> Result<(), String> {
    (matches!(window.label(), CONTROL | OVERLAY))
        .then_some(())
        .ok_or_else(|| "Only the control or overlay may invoke this command".into())
}

fn init_script(token: &str) -> String {
    format!(
        r#"(()=>{{const channel='flowclicker-diagnostic',token='{token}',send=event=>chrome.webview.postMessage(JSON.stringify({{channel,token,event}})),relay=e=>send({{event:e.type,isTrusted:e.isTrusted,x:e.clientX||0,y:e.clientY||0,button:e.button||0,buttons:e.buttons||0,pointerType:e.pointerType||'mouse',pointerId:e.pointerId||0,timestamp:e.timeStamp,url:location.href,origin:location.origin,viewport:{{width:innerWidth,height:innerHeight}},repeat:e.repeat||false,shortcut:(()=>{{let k=e.key;if(/^[a-z]$/i.test(k))k=k.toUpperCase();else if(k===' ')k='Space';else if(!/^\\d$/.test(k)&&!/^F(?:[1-9]|1[0-2])$/.test(k)&&k!=='Enter')return null;const m=[e.ctrlKey?'Ctrl':null,e.altKey?'Alt':null,e.shiftKey?'Shift':null,e.metaKey?'Meta':null].filter(Boolean);return m.length||/^F/.test(k)?[...m,k].join('+'):null}})()}});for(const name of ['pointermove','pointerdown','mousedown','pointerup','mouseup','click'])addEventListener(name,relay,true);addEventListener('keydown',relay,true)}})()"#
    )
}

#[tauri::command]
fn focus_game(window: Webview, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_window("game")
        .ok_or("Game window is not open")?
        .set_focus()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn reload_game(window: Webview, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_webview("game")
        .ok_or("Game window is not open")?
        .eval("location.reload()")
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn close_game(window: Webview, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_window("game")
        .ok_or("Game window is not open")?
        .close()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_control_panel(window: Webview, x: f64, y: f64) -> Result<(), String> {
    control_only(&window)?;
    let (x, y) = control_panel_position(x, y)?;
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

fn browser_state_dir() -> Result<std::path::PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .ok_or("LOCALAPPDATA is unavailable")?;
    Ok(std::path::PathBuf::from(base).join(BROWSER_POC_DIR))
}

#[tauri::command]
fn load_state(window: Webview) -> Result<Option<String>, String> {
    control_only(&window)?;
    storage::load_from_dir(&browser_state_dir()?)
}

#[tauri::command]
fn save_state(window: Webview, state_json: String) -> Result<(), String> {
    control_only(&window)?;
    storage::save_to_dir(&state_json, &browser_state_dir()?)
}

#[tauri::command]
fn platform_info(window: Webview) -> Result<serde_json::Value, String> {
    control_only(&window)?;
    Ok(serde_json::json!({
        "os": "Windows (WebView2)",
        "physicalMouseSupported": false,
        "globalRecordingSupported": false,
        "windowRelativeSupported": false,
        "accessibilityNote": "Browser-local input uses the game WebView viewport."
    }))
}

#[tauri::command]
fn start_recording(window: Webview, state: TauriState<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
    *state
        .capture_armed
        .lock()
        .map_err(|_| "State lock failed")? = true;
    *state
        .last_capture_timestamp
        .lock()
        .map_err(|_| "State lock failed")? = None;
    Ok(())
}

#[tauri::command]
fn stop_recording(window: Webview, state: TauriState<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
    *state
        .capture_armed
        .lock()
        .map_err(|_| "State lock failed")? = false;
    Ok(())
}

#[tauri::command]
fn set_hotkeys(
    window: Webview,
    record_hotkey: String,
    playback_hotkey: String,
    state: TauriState<'_, Arc<State>>,
) -> Result<(), String> {
    control_only(&window)?;
    validate_hotkey(&record_hotkey)?;
    validate_hotkey(&playback_hotkey)?;
    *state
        .record_hotkey
        .lock()
        .map_err(|_| "State lock failed")? = record_hotkey;
    *state
        .playback_hotkey
        .lock()
        .map_err(|_| "State lock failed")? = playback_hotkey;
    Ok(())
}

fn validate_hotkey(value: &str) -> Result<(), String> {
    let parts: Vec<_> = value.split('+').collect();
    if parts.is_empty() || parts.len() > 5 || parts.iter().any(|part| part.is_empty()) {
        return Err("Invalid hotkey".into());
    }
    let key = parts.last().unwrap();
    let valid_key = (key.len() == 1 && key.chars().all(|c| c.is_ascii_alphanumeric()))
        || matches!(
            *key,
            "Space"
                | "Enter"
                | "F1"
                | "F2"
                | "F3"
                | "F4"
                | "F5"
                | "F6"
                | "F7"
                | "F8"
                | "F9"
                | "F10"
                | "F11"
                | "F12"
        );
    if !valid_key
        || parts[..parts.len() - 1]
            .iter()
            .any(|p| !matches!(*p, "Ctrl" | "Alt" | "Shift" | "Meta"))
    {
        return Err("Invalid hotkey".into());
    }
    Ok(())
}

#[tauri::command]
fn set_playback_hud(window: Webview, active: bool) -> Result<(), String> {
    control_only(&window)?;
    window
        .set_size(tauri::LogicalSize::new(
            if active {
                CONTROL_HUD_WIDTH
            } else {
                CONTROL_WIDTH
            },
            if active {
                CONTROL_HUD_HEIGHT
            } else {
                CONTROL_HEIGHT
            },
        ))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_activity_badge(
    window: Webview,
    app: tauri::AppHandle,
    activity: String,
) -> Result<(), String> {
    control_only(&window)?;
    activity_badge::set_for_window(&app, "game", &activity)
}

#[tauri::command]
fn show_overlay(
    window: Webview,
    app: tauri::AppHandle,
    actions_json: String,
    interactive: bool,
) -> Result<(), String> {
    control_only(&window)?;
    let (actions, _) = browser_actions::flatten(&actions_json)?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is unavailable")?;
    let game = app.get_window("game").ok_or("Game window is not open")?;
    let control = interactive
        .then(|| {
            app.get_webview(CONTROL)
                .ok_or("Control webview is not open")
        })
        .transpose()?;
    let origin = game.inner_position().map_err(|e| e.to_string())?;
    overlay
        .set_ignore_cursor_events(!interactive)
        .map_err(|e| e.to_string())?;
    overlay
        .set_focusable(interactive)
        .map_err(|e| e.to_string())?;
    overlay.show().map_err(|e| e.to_string())?;
    if let Err(error) = app.emit_to("overlay", "overlay-points", serde_json::json!({
        "points": actions.iter().enumerate().map(|(i, click)| serde_json::json!({"actionId": click.action_id.clone().unwrap_or_else(|| i.to_string()), "label": (i + 1).to_string(), "x": origin.x as f64 + click.x, "y": origin.y as f64 + click.y})).collect::<Vec<_>>(),
        "interactive": interactive, "originX": origin.x, "originY": origin.y
    })) {
        let _ = overlay.hide();
        return Err(error.to_string());
    }
    if let Some(control) = control {
        if let Err(error) = control.hide() {
            let _ = overlay.hide();
            return Err(error.to_string());
        }
        if let Err(error) = overlay.set_focus() {
            let _ = control.show();
            let _ = overlay.hide();
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_overlay(window: Webview) -> Result<(), String> {
    control_or_overlay(&window)?;
    window
        .app_handle()
        .get_webview_window("overlay")
        .ok_or("Overlay is unavailable")?
        .hide()
        .map_err(|e| e.to_string())?;
    let control = window
        .app_handle()
        .get_webview(CONTROL)
        .ok_or("Control webview is not open")?;
    control
        .set_size(tauri::LogicalSize::new(CONTROL_WIDTH, CONTROL_HEIGHT))
        .map_err(|e| e.to_string())?;
    control.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn overlay_marker_moved(
    window: Webview,
    app: tauri::AppHandle,
    action_id: String,
    screen_x: i32,
    screen_y: i32,
    viewport_width: f64,
    viewport_height: f64,
) -> Result<(), String> {
    let origin = app
        .get_window("game")
        .ok_or("Game window is not open")?
        .inner_position()
        .map_err(|e| e.to_string())?;
    let viewport_x = screen_x
        .checked_sub(origin.x)
        .ok_or("Marker coordinate overflow")?;
    let viewport_y = screen_y
        .checked_sub(origin.y)
        .ok_or("Marker coordinate overflow")?;
    valid_marker_move(
        window.label(),
        viewport_x,
        viewport_y,
        viewport_width,
        viewport_height,
    )?;
    app.emit_to(
        "control",
        "overlay-action-moved",
        serde_json::json!({
            "actionId": action_id,
            "screenX": viewport_x,
            "screenY": viewport_y,
            "viewportWidth": viewport_width,
            "viewportHeight": viewport_height
        }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn export_portable_data(
    window: Webview,
    app: tauri::AppHandle,
    data_json: String,
    file_name: String,
) -> Result<bool, String> {
    control_only(&window)?;
    let path = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("FlowClicker data", &["flowclicker.json"])
        .blocking_save_file()
        .and_then(|value| value.into_path().ok());
    if let Some(path) = path {
        std::fs::write(path, data_json).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn pick_portable_data(window: Webview, app: tauri::AppHandle) -> Result<Option<String>, String> {
    control_only(&window)?;
    app.dialog()
        .file()
        .add_filter("FlowClicker data", &["flowclicker.json"])
        .blocking_pick_file()
        .and_then(|value| value.into_path().ok())
        .map(|path| std::fs::read_to_string(path).map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
fn retarget_click(
    window: Webview,
    _window_title: Option<String>,
    screen_x: i32,
    screen_y: i32,
) -> Result<serde_json::Value, String> {
    control_only(&window)?;
    Ok(
        serde_json::json!({"screenX": screen_x, "screenY": screen_y, "relativeX": null, "relativeY": null, "windowTitle": null}),
    )
}

#[tauri::command]
async fn play_flow(
    window: Webview,
    app: tauri::AppHandle,
    state: TauriState<'_, Arc<State>>,
    actions_json: String,
    options_json: String,
) -> Result<(), String> {
    control_only(&window)?;
    let (actions, trailing_delay_ms) = browser_actions::flatten(&actions_json)?;
    let options: serde_json::Value = serde_json::from_str(&options_json)
        .map_err(|e| format!("Invalid playback options: {e}"))?;
    let repeat_mode = options
        .get("repeatMode")
        .and_then(|v| v.as_str())
        .unwrap_or("cycles");
    let repeat_value = options
        .get("repeatValue")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .clamp(1, 10_000);
    let speed = options
        .get("speed")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0)
        .clamp(1.0, 50.0);
    let settle_ms = options
        .get("settleMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(5_000);
    let hold_ms = options
        .get("holdMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(5_000);
    let until_time = options.get("untilTime").and_then(|v| v.as_u64());
    begin_replay(state.inner())?;
    app.emit_to(CONTROL, "playback-state", "playing")
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let result = win::play_browser_flow(
        &app,
        state.inner(),
        actions,
        repeat_mode,
        repeat_value,
        speed,
        settle_ms,
        hold_ms,
        trailing_delay_ms,
        until_time,
    )
    .await;
    #[cfg(not(windows))]
    let result: Result<(), String> = Err("WebView2 POC is Windows-only".into());
    finish_replay(state.inner());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    app.emit_to(CONTROL, "playback-state", "stopped")
        .map_err(|e| e.to_string())?;
    if let Err(error) = &result {
        let _ = app.emit_to(CONTROL, "playback-error", error.clone());
    }
    result
}

#[tauri::command]
fn stop_playback(window: Webview, state: TauriState<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
    state
        .playback
        .lock()
        .map_err(|_| "State lock failed")?
        .cancelled = true;
    Ok(())
}

#[tauri::command]
fn arm_physical_capture(
    window: Webview,
    state: tauri::State<'_, Arc<State>>,
) -> Result<(), String> {
    control_only(&window)?;
    #[cfg(windows)]
    {
        win::arm_capture(state.inner().clone())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("WebView2 POC is Windows-only".into())
    }
}
#[tauri::command]
async fn replay_last_click(
    window: Webview,
    state: tauri::State<'_, Arc<State>>,
    start_delay_ms: u64,
    settle_ms: u64,
    hold_ms: u64,
) -> Result<ReplayResult, String> {
    control_only(&window)?;
    if start_delay_ms > 60_000 || settle_ms > 5000 || hold_ms > 5000 {
        return Err("Timing must be between 0 and 5000 ms".into());
    }
    let click = state
        .last_click
        .lock()
        .map_err(|_| "State lock failed")?
        .clone()
        .ok_or("No physical click captured")?;
    valid_click(&click)?;
    #[cfg(windows)]
    {
        return win::replay(
            &window.app_handle(),
            &state,
            click,
            start_delay_ms,
            settle_ms,
            hold_ms,
        )
        .await;
    }
    #[cfg(not(windows))]
    {
        let _ = (state, click, start_delay_ms, settle_ms, hold_ms);
        Err("WebView2 POC is Windows-only".into())
    }
}

#[tauri::command]
async fn sample_host_diagnostics(
    window: Webview,
    app: tauri::AppHandle,
    countdown_ms: u64,
) -> Result<HostDiagnostics, String> {
    control_only(&window)?;
    if countdown_ms > 60_000 {
        return Err("Countdown must be between 0 and 60000 ms".into());
    }
    tokio::time::sleep(std::time::Duration::from_millis(countdown_ms)).await;
    #[cfg(windows)]
    {
        return win::host_diagnostics(&app).await;
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("WebView2 POC is Windows-only".into())
    }
}

#[tauri::command]
fn start_repeated_replay(
    window: Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<State>>,
    start_delay_ms: u64,
    interval_ms: u64,
) -> Result<(), String> {
    control_only(&window)?;
    if start_delay_ms > 60_000 || !(100..=60_000).contains(&interval_ms) {
        return Err("Start delay must be at most 60000 ms and interval 100–60000 ms".into());
    }
    let state = state.inner().clone();
    let click = state
        .last_click
        .lock()
        .map_err(|_| "State lock failed")?
        .clone()
        .ok_or("No physical click captured")?;
    begin_replay(&state)?;
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        {
            win::replay_loop(app, state, click, start_delay_ms, interval_ms).await;
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_replay(window: Webview, state: tauri::State<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
    state
        .playback
        .lock()
        .map_err(|_| "State lock failed")?
        .cancelled = true;
    Ok(())
}
#[tauri::command]
fn clear_test(window: Webview, state: tauri::State<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
    let mut playback = state.playback.lock().map_err(|_| "State lock failed")?;
    if playback.active {
        return Err("Stop replay before clearing evidence".into());
    }
    *state.last_click.lock().map_err(|_| "State lock failed")? = None;
    state
        .physical_events
        .lock()
        .map_err(|_| "State lock failed")?
        .clear();
    state
        .replay_events
        .lock()
        .map_err(|_| "State lock failed")?
        .clear();
    *state
        .capture_armed
        .lock()
        .map_err(|_| "State lock failed")? = false;
    *playback = PlaybackState::default();
    Ok(())
}
#[tauri::command]
async fn run_backend_self_test(
    window: Webview,
    app: tauri::AppHandle,
) -> Result<SelfTestResult, String> {
    control_only(&window)?;
    #[cfg(windows)]
    {
        let game = app.get_webview("game").ok_or("Game window is not open")?;
        win::self_test(&game).await
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("WebView2 POC is Windows-only".into())
    }
}

#[cfg(windows)]
mod win;

fn main() {
    let state = Arc::new(State::new(uuid::Uuid::new_v4().simple().to_string()));
    let script = init_script(&state.message_token);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .setup(move |app| {
            #[cfg(windows)]
            win::install_handlers(app.handle().clone(), state.clone(), script)?;
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            focus_game,
            reload_game,
            close_game,
            arm_physical_capture,
            replay_last_click,
            sample_host_diagnostics,
            start_repeated_replay,
            stop_replay,
            clear_test,
            run_backend_self_test,
            load_state,
            save_state,
            platform_info,
            start_recording,
            stop_recording,
            set_hotkeys,
            set_playback_hud,
            set_activity_badge,
            show_overlay,
            hide_overlay,
            overlay_marker_moved,
            export_portable_data,
            pick_portable_data,
            play_flow,
            stop_playback,
            retarget_click,
            move_control_panel
        ])
        .run(tauri::generate_context!())
        .expect("error while running trusted-input POC");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn security_and_payload_contracts() {
        assert!(allowed_origin("https://pockieninja.online"));
        assert!(allowed_origin("https://a.pockieninja.online/game"));
        assert!(!allowed_origin("https://pockieninja.online.evil.test"));
        assert!(!allowed_origin("http://pockieninja.online"));
        assert!(!allowed_origin("https://pockieninja.online.evil"));
        assert!(!allowed_navigation(
            "http://tauri.localhost/controlled.html"
        ));
        assert!(!allowed_navigation("http://tauri.localhost/other.html"));
        assert_eq!(
            sanitize_url("https://pockieninja.online/?token=secret#x"),
            "https://pockieninja.online/"
        );
        let c = Click {
            action_id: None,
            x: 1.,
            y: 2.,
            viewport: Viewport {
                width: 3.,
                height: 4.,
            },
            button: "left".into(),
            delay_ms: 0,
        };
        assert_eq!(
            cdp_mouse_payload("mouseMoved", &c).unwrap()["pointerType"],
            "mouse"
        );
        assert_eq!(
            cdp_mouse_payload("mouseMoved", &c).unwrap()["button"],
            "none"
        );
        assert_eq!(cdp_mouse_payload("mouseMoved", &c).unwrap()["buttons"], 0);
        assert_eq!(cdp_mouse_payload("mousePressed", &c).unwrap()["buttons"], 1);
        assert_eq!(
            cdp_mouse_payload("mouseReleased", &c).unwrap()["buttons"],
            0
        );
        let right = Click {
            button: "right".into(),
            ..c.clone()
        };
        assert_eq!(
            cdp_mouse_payload("mousePressed", &right).unwrap()["buttons"],
            2
        );
        assert!(cdp_mouse_payload("mouseMoved", &Click { x: 3., ..c.clone() }).is_err());
        assert_eq!(iframe_offset((10., 20.), (3., 4.)), (13., 24.));
        assert_eq!(
            error_class(true, false, false, false),
            "immediate COM failure"
        );
        let state = State::default();
        state.playback.lock().unwrap().cancelled = true;
        assert!(cancelled(&state));
    }
    #[test]
    fn diagnostic_schema_rejects_untrusted_shape() {
        assert!(diagnostic("{}").is_err());
        assert!(diagnostic(r#"{"event":"click","isTrusted":true,"x":1,"y":1,"button":0,"buttons":1,"pointerType":"mouse","pointerId":1,"timestamp":1,"url":"https://pockieninja.online/","origin":"https://evil.test","viewport":{"width":2,"height":2}}"#).is_err());
    }

    #[test]
    fn contained_host_keeps_fixed_geometry_and_clamps_child() {
        assert_eq!((CONTROL_WIDTH, CONTROL_HEIGHT), (460, 752));
        assert_eq!((CONTROL_HUD_WIDTH, CONTROL_HUD_HEIGHT), (220, 36));
        assert_eq!((GAME_VIEWPORT_WIDTH, GAME_VIEWPORT_HEIGHT), (1600, 900));
        assert_eq!(control_panel_position(-1.0, 500.0).unwrap(), (0.0, 148.0));
        assert_eq!(control_panel_position(2000.0, -1.0).unwrap(), (1140.0, 0.0));
        assert!(control_panel_position(f64::NAN, 0.0).is_err());
    }

    #[test]
    fn config_has_one_visible_host_and_runtime_child_control() {
        let config = include_str!("../tauri.conf.json");
        assert_eq!(config.matches(r#""label": "game""#).count(), 1);
        assert!(!config.contains(r#""label": "control""#));
        let windows = include_str!("win.rs");
        assert!(windows.contains("game_window.add_child("));
        assert!(windows.contains("WebviewBuilder::new(CONTROL"));
    }

    #[test]
    fn host_lookup_stays_native_after_child_webview_is_added() {
        let main = include_str!("main.rs");
        let windows = include_str!("win.rs");
        assert!(!main.contains("get_webview_window(\"game\")"));
        assert!(!windows.contains("get_webview_window(\"game\")"));
        assert!(main.contains("get_window(\"game\")"));
        assert!(windows.contains("get_window(\"game\")"));
    }

    #[test]
    fn playback_events_target_the_child_and_hud_resizes_the_child() {
        let main = include_str!("main.rs");
        let windows = include_str!("win.rs");
        assert!(main.contains("app.emit_to(CONTROL, \"playback-state\", \"playing\")"));
        assert!(main.contains("app.emit_to(CONTROL, \"playback-state\", \"stopped\")"));
        assert!(main.contains("app.emit_to(CONTROL, \"playback-error\""));
        assert!(main.contains(".get(\"speed\")"));
        assert!(main.contains(".get(\"settleMs\")"));
        assert!(main.contains(".get(\"holdMs\")"));
        assert!(main.contains(".get(\"untilTime\")"));
        assert!(windows.contains("CONTROL,\n            \"playback-progress\""));
        assert!(
            main.contains("CONTROL_HUD_WIDTH\n            } else {\n                CONTROL_WIDTH")
        );
        assert!(main.contains("if active {\n                CONTROL_HUD_HEIGHT\n            } else {\n                CONTROL_HEIGHT\n            }"));
        assert!(main.contains("control_or_overlay(&window)?"));
        assert!(main
            .contains("control.set_size(tauri::LogicalSize::new(CONTROL_WIDTH, CONTROL_HEIGHT))"));
    }

    #[test]
    fn injected_diagnostics_do_not_cancel_page_context_menus() {
        let script = init_script("token");
        assert!(!script.contains("contextmenu"));
        assert!(script.contains("chrome.webview.postMessage"));
        assert!(!script.contains("parent.postMessage"));
        assert!(script.contains("button:e.button||0"));
        assert!(script.contains("shortcut:"));
    }

    #[test]
    fn recording_routes_left_right_and_hotkeys_once() {
        let event = |kind: &str, button: i32, shortcut: Option<&str>| DiagnosticEvent {
            event: kind.into(),
            is_trusted: true,
            x: 1.0,
            y: 2.0,
            button,
            buttons: 0,
            pointer_type: "mouse".into(),
            pointer_id: 1,
            timestamp: 1.0,
            url: GAME_URL.into(),
            origin: GAME_URL.trim_end_matches('/').into(),
            viewport: Viewport {
                width: 10.0,
                height: 10.0,
            },
            shortcut: shortcut.map(str::to_owned),
            repeat: false,
        };
        assert_eq!(
            recorded_button(&event("pointerdown", 0, None)),
            Some("left")
        );
        assert_eq!(
            recorded_button(&event("pointerdown", 2, None)),
            Some("right")
        );
        assert_eq!(recorded_button(&event("click", 0, None)), None);
        assert_eq!(
            hotkey_command(
                &event("keydown", 0, Some("Alt+Shift+R")),
                "Alt+Shift+R",
                "Alt+Shift+P"
            ),
            Some("record")
        );
        assert_eq!(
            hotkey_command(
                &event("keydown", 0, Some("Alt+Shift+P")),
                "Alt+Shift+R",
                "Alt+Shift+P"
            ),
            Some("playback")
        );
    }

    #[test]
    fn marker_moves_require_overlay_and_viewport_bounds() {
        assert!(valid_marker_move("overlay", 1919, 1079, 1920.0, 1080.0).is_ok());
        assert!(valid_marker_move("control", 1, 1, 1920.0, 1080.0).is_err());
        assert!(valid_marker_move("overlay", 1920, 1, 1920.0, 1080.0).is_err());
    }

    #[test]
    fn overlay_has_its_own_event_capability() {
        let capability = include_str!("../capabilities/overlay.json");
        assert!(capability.contains(r#""windows": ["overlay"]"#));
        assert!(capability.contains("core:event:default"));
    }
}
