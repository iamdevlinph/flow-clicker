use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

pub const CONTROL: &str = "control";
pub const OVERLAY: &str = "overlay";
pub const GAME_URL: &str = "https://pockieninja.online/";
pub const BROWSER_POC_DIR: &str = "FlowClicker\\browser-poc";
pub const CONTROL_WIDTH: u32 = 460;
pub const CONTROL_CONTENT_HEIGHT: u32 = 720;
pub const CONTROL_TITLEBAR_HEIGHT: u32 = 32;
pub const CONTROL_HEIGHT: u32 = CONTROL_CONTENT_HEIGHT + CONTROL_TITLEBAR_HEIGHT;
pub const CONTROL_HUD_WIDTH: u32 = 220;
pub const CONTROL_HUD_HEIGHT: u32 = 36;
pub const GAME_VIEWPORT_WIDTH: u32 = 1600;
pub const GAME_VIEWPORT_HEIGHT: u32 = 900;
pub const CONTROL_MAX_X: f64 = (GAME_VIEWPORT_WIDTH - CONTROL_WIDTH) as f64;
pub const CONTROL_MAX_Y: f64 = (GAME_VIEWPORT_HEIGHT - CONTROL_HEIGHT) as f64;

pub fn control_panel_position(x: f64, y: f64) -> Result<(f64, f64), String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("Panel position must be finite".into());
    }
    Ok((x.clamp(0.0, CONTROL_MAX_X), y.clamp(0.0, CONTROL_MAX_Y)))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct DiagnosticEvent {
    pub event: String,
    #[serde(rename = "isTrusted")]
    pub is_trusted: bool,
    pub x: f64,
    pub y: f64,
    pub button: i32,
    pub buttons: i32,
    #[serde(rename = "pointerType")]
    pub pointer_type: String,
    #[serde(rename = "pointerId")]
    pub pointer_id: i64,
    pub timestamp: f64,
    pub url: String,
    pub origin: String,
    pub viewport: Viewport,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub repeat: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Click {
    #[serde(default, skip_serializing)]
    pub action_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub viewport: Viewport,
    #[serde(default = "left_button")]
    pub button: String,
    #[serde(default)]
    pub delay_ms: u64,
}

fn left_button() -> String {
    "left".into()
}

#[derive(Clone, Debug, Serialize)]
pub struct HostDiagnostics {
    pub runtime_version: String,
    pub url: String,
    pub viewport: Option<Viewport>,
    pub device_pixel_ratio: Option<f64>,
    pub zoom: Option<f64>,
    pub visibility_state: String,
    pub hwnd: isize,
    pub controller_available: bool,
    pub core_webview2_available: bool,
    pub window_rect: [i32; 4],
    pub controller_bounds: [i32; 4],
    pub visible: bool,
    pub enabled: bool,
    pub style: isize,
    pub ex_style: isize,
    pub focusable: bool,
    pub opaque: bool,
    pub ignores_cursor_events: bool,
    pub foreground_hwnd: isize,
    pub cursor: [i32; 2],
    pub window_from_point: isize,
    pub ancestor_chain: Vec<isize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReplayResult {
    pub cursor_before: [i32; 2],
    pub cursor_after: [i32; 2],
    pub cursor_moved: bool,
    pub foreground_before: isize,
    pub foreground_after: isize,
    pub cdp: Vec<String>,
    pub physical_events: Vec<DiagnosticEvent>,
    pub replay_events: Vec<DiagnosticEvent>,
    pub activation: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SelfTestResult {
    pub value: i64,
    pub invalid: String,
}

pub struct State {
    pub last_click: Mutex<Option<Click>>,
    pub physical_events: Mutex<Vec<DiagnosticEvent>>,
    pub replay_events: Mutex<Vec<DiagnosticEvent>>,
    pub capture_armed: Mutex<bool>,
    pub playback: Mutex<PlaybackState>,
    pub last_capture_timestamp: Mutex<Option<f64>>,
    pub record_hotkey: Mutex<String>,
    pub playback_hotkey: Mutex<String>,
    pub message_token: String,
}

impl State {
    pub fn new(message_token: String) -> Self {
        Self {
            last_click: Mutex::default(),
            physical_events: Mutex::default(),
            replay_events: Mutex::default(),
            capture_armed: Mutex::default(),
            playback: Mutex::default(),
            last_capture_timestamp: Mutex::default(),
            record_hotkey: Mutex::default(),
            playback_hotkey: Mutex::default(),
            message_token,
        }
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new(String::new())
    }
}

#[derive(Default)]
pub struct PlaybackState {
    pub active: bool,
    pub cancelled: bool,
}

pub fn allowed_origin(value: &str) -> bool {
    if matches!(value, "tauri://localhost" | "http://tauri.localhost") {
        return true;
    }
    let Some(rest) = value.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split('/')
        .next()
        .unwrap_or_default()
        .split('@')
        .next_back()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default();
    host == "pockieninja.online" || host.ends_with(".pockieninja.online")
}

pub fn allowed_navigation(value: &str) -> bool {
    value == "about:blank" || allowed_origin(value)
}

pub fn origin(value: &str) -> Option<String> {
    if value.starts_with("tauri://localhost/") {
        return Some("tauri://localhost".into());
    }
    if value.starts_with("http://tauri.localhost/") {
        return Some("http://tauri.localhost".into());
    }
    let rest = value.strip_prefix("https://")?;
    let host = rest
        .split('/')
        .next()?
        .split('@')
        .next_back()?
        .split(':')
        .next()?;
    Some(format!("https://{host}"))
}

pub fn sanitize_url(value: &str) -> String {
    value
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_string()
}

pub fn valid_click(click: &Click) -> Result<(), String> {
    if !matches!(click.button.as_str(), "left" | "right") {
        return Err("Only left and right buttons are supported".into());
    }
    let finite = |n: f64| n.is_finite() && n >= 0.0;
    if !finite(click.x)
        || !finite(click.y)
        || !finite(click.viewport.width)
        || !finite(click.viewport.height)
        || click.viewport.width <= 0.0
        || click.viewport.height <= 0.0
    {
        return Err("Coordinates and viewport must be finite and nonnegative".into());
    }
    if click.x >= click.viewport.width || click.y >= click.viewport.height {
        return Err("Click is outside the captured viewport".into());
    }
    Ok(())
}

pub fn valid_marker_move(
    label: &str,
    x: i32,
    y: i32,
    viewport_width: f64,
    viewport_height: f64,
) -> Result<(), String> {
    if label != "overlay" {
        return Err("Only the overlay may move markers".into());
    }
    if !viewport_width.is_finite()
        || !viewport_height.is_finite()
        || viewport_width <= 0.0
        || viewport_height <= 0.0
        || x < 0
        || y < 0
        || f64::from(x) >= viewport_width
        || f64::from(y) >= viewport_height
    {
        return Err("Marker position is outside the browser viewport".into());
    }
    Ok(())
}

pub fn diagnostic(value: &str) -> Result<DiagnosticEvent, String> {
    if value.len() > 16 * 1024 {
        return Err("Diagnostic message is too large".into());
    }
    let mut event: DiagnosticEvent =
        serde_json::from_str(value).map_err(|_| "Malformed diagnostic JSON".to_string())?;
    if !matches!(
        event.event.as_str(),
        "pointermove" | "pointerdown" | "mousedown" | "pointerup" | "mouseup" | "click" | "keydown"
    ) || !event.is_trusted
        || event.url.len() > 2048
        || event.origin.len() > 512
        || !allowed_origin(&event.origin)
        || event.viewport.width <= 0.0
        || event.viewport.height <= 0.0
        || event.x < 0.0
        || event.y < 0.0
        || event.x >= event.viewport.width
        || event.y >= event.viewport.height
        || event.event == "keydown" && event.shortcut.is_none()
    {
        return Err("Diagnostic schema or origin rejected".into());
    }
    event.url = sanitize_url(&event.url);
    Ok(event)
}

pub fn accept_diagnostic(
    channel: &str,
    source: &str,
    value: &str,
) -> Result<DiagnosticEvent, String> {
    let source = origin(source).ok_or("Diagnostic channel or source origin rejected")?;
    if channel != "flowclicker-diagnostic" || !allowed_origin(&source) {
        return Err("Diagnostic channel or source origin rejected".into());
    }
    diagnostic(value)
}

pub fn recorded_button(event: &DiagnosticEvent) -> Option<&'static str> {
    match (event.event.as_str(), event.button) {
        ("pointerdown", 0) => Some("left"),
        ("pointerdown", 2) => Some("right"),
        _ => None,
    }
}

pub fn hotkey_command<'a>(
    event: &DiagnosticEvent,
    record: &'a str,
    playback: &'a str,
) -> Option<&'a str> {
    if event.event != "keydown" || event.repeat {
        return None;
    }
    match event.shortcut.as_deref() {
        Some(value) if value == record => Some("record"),
        Some(value) if value == playback => Some("playback"),
        _ => None,
    }
}

pub fn cdp_mouse_payload(method: &str, click: &Click) -> Result<Value, String> {
    valid_click(click)?;
    if !matches!(method, "mouseMoved" | "mousePressed" | "mouseReleased") {
        return Err("Unsupported CDP mouse method".into());
    }
    let button = click.button.as_str();
    let payload = serde_json::json!({"type": method, "x": click.x, "y": click.y, "button": if method == "mouseMoved" { "none" } else { button }, "clickCount": 1, "pointerType": "mouse", "buttons": if method == "mousePressed" {
        if button == "right" {
            2
        } else {
            1
        }
    } else {
        0
    }});
    Ok(payload)
}

pub fn begin_replay(state: &State) -> Result<(), String> {
    let mut playback = state.playback.lock().map_err(|_| "State lock failed")?;
    if playback.active {
        return Err("Replay is already running".into());
    }
    playback.active = true;
    playback.cancelled = false;
    Ok(())
}

pub fn cancelled(state: &State) -> bool {
    state
        .playback
        .lock()
        .map(|value| value.cancelled)
        .unwrap_or(true)
}

pub fn finish_replay(state: &State) {
    if let Ok(mut playback) = state.playback.lock() {
        playback.active = false;
    }
}

pub fn iframe_offset(parent: (f64, f64), child: (f64, f64)) -> (f64, f64) {
    (parent.0 + child.0, parent.1 + child.1)
}

pub fn error_class(com: bool, callback: bool, json: bool, cdp: bool) -> &'static str {
    if com {
        "immediate COM failure"
    } else if callback {
        "completion callback failure"
    } else if json {
        "malformed JSON"
    } else if cdp {
        "CDP error object"
    } else {
        "unknown bridge error"
    }
}
