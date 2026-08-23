#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod input;
mod models;
mod platform;
mod storage;

use crate::{input::RuntimeState, models::{FlowAction, OverlayMove, OverlayPayload, OverlayPoint, PlaybackOptions, PlatformInfo, RecordedClick}};
use enigo::{Enigo, Mouse, Settings};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};

#[tauri::command]
fn load_state() -> Result<Option<String>, String> {
    storage::load()
}

#[tauri::command]
fn save_state(state_json: String) -> Result<(), String> {
    storage::save(&state_json)
}

#[tauri::command]
fn start_recording(runtime: State<'_, Arc<RuntimeState>>) -> Result<(), String> {
    input::start_recording(runtime.inner().as_ref())
}

#[tauri::command]
fn stop_recording(runtime: State<'_, Arc<RuntimeState>>) {
    input::stop_recording(runtime.inner().as_ref());
}

#[tauri::command]
fn set_hotkeys(runtime: State<'_, Arc<RuntimeState>>, record_hotkey: String, playback_hotkey: String) {
    input::set_hotkeys(runtime.inner().as_ref(), record_hotkey, playback_hotkey);
}

#[tauri::command]
fn play_flow(app: AppHandle, runtime: State<'_, Arc<RuntimeState>>, actions_json: String, options_json: String) -> Result<(), String> {
    let actions: Vec<FlowAction> = serde_json::from_str(&actions_json).map_err(|e| format!("Invalid actions: {e}"))?;
    let options: PlaybackOptions = serde_json::from_str(&options_json).map_err(|e| format!("Invalid playback options: {e}"))?;
    input::play(app, runtime.inner().clone(), actions, options)
}

#[tauri::command]
fn stop_playback(runtime: State<'_, Arc<RuntimeState>>) {
    runtime.stop_playback.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
fn cursor_snapshot() -> Result<RecordedClick, String> {
    let enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let (x, y) = enigo.location().map_err(|e| e.to_string())?;
    let snap = platform::foreground();
    let (rx, ry) = match (snap.left, snap.top) {
        (Some(left), Some(top)) => (Some(x - left), Some(y - top)),
        _ => (None, None),
    };
    Ok(RecordedClick {
        screen_x: x,
        screen_y: y,
        relative_x: rx,
        relative_y: ry,
        window_title: snap.title,
        delay_ms: 0,
    })
}

#[tauri::command]
fn retarget_click(window_title: Option<String>, screen_x: i32, screen_y: i32) -> RecordedClick {
    let (rx, ry) = platform::retarget(window_title.as_deref(), screen_x, screen_y);
    RecordedClick {
        screen_x,
        screen_y,
        relative_x: rx,
        relative_y: ry,
        window_title,
        delay_ms: 0,
    }
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    platform::info()
}

#[tauri::command]
fn show_overlay(app: AppHandle, actions_json: String, interactive: bool) -> Result<(), String> {
    let actions: Vec<FlowAction> = serde_json::from_str(&actions_json).map_err(|e| e.to_string())?;
    let overlay = app.get_webview_window("overlay").ok_or("Overlay window is unavailable")?;
    let monitor = overlay.primary_monitor().map_err(|e| e.to_string())?.ok_or("No primary monitor found")?;
    let position = *monitor.position();
    let size = *monitor.size();
    overlay.set_position(PhysicalPosition::new(position.x, position.y)).map_err(|e| e.to_string())?;
    overlay.set_size(PhysicalSize::new(size.width, size.height)).map_err(|e| e.to_string())?;
    overlay.set_always_on_top(true).map_err(|e| e.to_string())?;
    overlay.set_ignore_cursor_events(!interactive).map_err(|e| e.to_string())?;

    let mut points = Vec::new();
    let mut click_no = 0usize;
    for action in &actions {
        if let Some(click) = action.as_click() {
            click_no += 1;
            let (x, y) = platform::resolve(&click, false);
            points.push(OverlayPoint {
                action_id: click.id.to_string(),
                label: format!("{click_no}"),
                x,
                y,
            });
        }
    }
    overlay.show().map_err(|e| e.to_string())?;
    let payload = OverlayPayload { points, interactive, origin_x: position.x, origin_y: position.y };
    app.emit_to("overlay", "overlay-points", payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let overlay = app.get_webview_window("overlay").ok_or("Overlay window is unavailable")?;
    overlay.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn overlay_marker_moved(app: AppHandle, action_id: String, screen_x: i32, screen_y: i32) -> Result<(), String> {
    app.emit_to("main", "overlay-action-moved", OverlayMove { action_id, screen_x, screen_y })
        .map_err(|e| e.to_string())
}

fn main() {
    let runtime = Arc::new(RuntimeState::default());
    tauri::Builder::default()
        .manage(runtime.clone())
        .setup(move |app| {
            input::start_listener(app.handle().clone(), runtime.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            start_recording,
            stop_recording,
            set_hotkeys,
            play_flow,
            stop_playback,
            cursor_snapshot,
            retarget_click,
            platform_info,
            show_overlay,
            hide_overlay,
            overlay_marker_moved,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FlowClicker");
}
