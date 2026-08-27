#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewWindow};

const CONTROL: &str = "control";
const GAME_URL: &str = "https://pockieninja.online/";
const PROFILE_DIR: &str = "FlowClicker\\webview-profile";

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
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Click {
    pub x: f64,
    pub y: f64,
    pub viewport: Viewport,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReplayResult {
    pub cursor_before: [i32; 2],
    pub cursor_after: [i32; 2],
    pub cursor_moved: bool,
    pub cdp: Vec<String>,
    pub physical_events: Vec<DiagnosticEvent>,
    pub replay_events: Vec<DiagnosticEvent>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SelfTestResult {
    pub valid: String,
    pub invalid: String,
}

#[derive(Default)]
struct State {
    last_click: Mutex<Option<Click>>,
    physical_events: Mutex<Vec<DiagnosticEvent>>,
    replay_events: Mutex<Vec<DiagnosticEvent>>,
    capture_armed: Mutex<bool>,
    replay_active: Mutex<bool>,
}

fn control_only(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == CONTROL)
        .then_some(())
        .ok_or_else(|| "Only the control window may invoke this command".into())
}

fn allowed_origin(value: &str) -> bool {
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

fn allowed_navigation(value: &str) -> bool {
    allowed_origin(value) && value.starts_with("https://")
}

fn origin(value: &str) -> Option<String> {
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

fn valid_click(click: &Click) -> Result<(), String> {
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

fn diagnostic(value: &str) -> Result<DiagnosticEvent, String> {
    if value.len() > 16 * 1024 {
        return Err("Diagnostic message is too large".into());
    }
    let event: DiagnosticEvent =
        serde_json::from_str(value).map_err(|_| "Malformed diagnostic JSON".to_string())?;
    if !matches!(
        event.event.as_str(),
        "pointermove" | "pointerdown" | "mousedown" | "pointerup" | "mouseup" | "click"
    ) || event.event.len() > 16
        || event.url.len() > 2048
        || event.origin.len() > 512
        || !allowed_origin(&event.origin)
        || event.viewport.width <= 0.0
        || event.viewport.height <= 0.0
        || event.x < 0.0
        || event.y < 0.0
        || event.x >= event.viewport.width
        || event.y >= event.viewport.height
    {
        return Err("Diagnostic schema or origin rejected".into());
    }
    Ok(event)
}

fn accept_diagnostic(channel: &str, source: &str, value: &str) -> Result<DiagnosticEvent, String> {
    let source = origin(source).ok_or("Diagnostic channel or source origin rejected")?;
    if channel != "flowclicker-diagnostic" || !allowed_origin(&source) {
        return Err("Diagnostic channel or source origin rejected".into());
    }
    diagnostic(value)
}

fn iframe_offset(parent: (f64, f64), child: (f64, f64)) -> (f64, f64) {
    (parent.0 + child.0, parent.1 + child.1)
}

fn cdp_mouse_payload(method: &str, click: &Click) -> Result<Value, String> {
    valid_click(click)?;
    let event = match method {
        "mouseMoved" | "mousePressed" | "mouseReleased" => method,
        _ => return Err("Unsupported CDP mouse method".into()),
    };
    let mut payload = serde_json::json!({"type": event, "x": click.x, "y": click.y, "button": "left", "clickCount": 1, "pointerType": "mouse"});
    if event != "mouseMoved" {
        payload["buttons"] = if event == "mousePressed" {
            Value::from(1)
        } else {
            Value::from(0)
        };
    }
    Ok(payload)
}

fn error_class(com: bool, callback: bool, json: bool, cdp: bool) -> &'static str {
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

const INIT_SCRIPT: &str = r#"(()=>{const channel='flowclicker-diagnostic';const send=event=>parent===window?chrome.webview.postMessage(JSON.stringify({channel,event})):parent.postMessage({channel,event},'*');const relay=e=>send({event:e.type,isTrusted:e.isTrusted,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,pointerType:e.pointerType||'mouse',pointerId:e.pointerId||0,timestamp:e.timeStamp,url:location.href,origin:location.origin,viewport:{width:innerWidth,height:innerHeight}});for(const name of ['pointermove','pointerdown','mousedown','pointerup','mouseup','click'])addEventListener(name,relay,true);addEventListener('message',e=>{if(!e.data||e.data.channel!==channel)return;const frame=[...document.querySelectorAll('iframe')].find(node=>node.contentWindow===e.source);if(!frame)return;const box=frame.getBoundingClientRect();send({...e.data.event,x:e.data.event.x+box.left,y:e.data.event.y+box.top,viewport:{width:innerWidth,height:innerHeight}})})})()"#;

#[tauri::command]
fn open_game(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    #[cfg(windows)]
    win::open_game(&app, INIT_SCRIPT, GAME_URL, PROFILE_DIR)?;
    #[cfg(not(windows))]
    {
        let _ = (app, INIT_SCRIPT);
        return Err("WebView2 POC is Windows-only".into());
    }
    Ok(())
}
#[tauri::command]
fn focus_game(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_webview_window("game")
        .ok_or("Game window is not open")?
        .set_focus()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn reload_game(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_webview_window("game")
        .ok_or("Game window is not open")?
        .eval("location.reload()")
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn close_game(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    control_only(&window)?;
    app.get_webview_window("game")
        .ok_or("Game window is not open")?
        .close()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn arm_physical_capture(
    window: WebviewWindow,
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
    window: WebviewWindow,
    state: tauri::State<'_, Arc<State>>,
    settle_ms: u64,
    hold_ms: u64,
) -> Result<ReplayResult, String> {
    control_only(&window)?;
    if settle_ms > 5000 || hold_ms > 5000 {
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
        return win::replay(&window.app_handle(), &state, click, settle_ms, hold_ms).await;
    }
    #[cfg(not(windows))]
    {
        let _ = (state, click, settle_ms, hold_ms);
        Err("WebView2 POC is Windows-only".into())
    }
}
#[tauri::command]
fn clear_test(window: WebviewWindow, state: tauri::State<'_, Arc<State>>) -> Result<(), String> {
    control_only(&window)?;
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
    *state
        .replay_active
        .lock()
        .map_err(|_| "State lock failed")? = false;
    Ok(())
}
#[tauri::command]
async fn run_backend_self_test(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<SelfTestResult, String> {
    control_only(&window)?;
    #[cfg(windows)]
    {
        let game = app
            .get_webview_window("game")
            .ok_or("Game window is not open")?;
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
    let state = Arc::new(State::default());
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            #[cfg(windows)]
            win::install_handlers(app.handle().clone(), state.clone())?;
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_game,
            focus_game,
            reload_game,
            close_game,
            arm_physical_capture,
            replay_last_click,
            clear_test,
            run_backend_self_test
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
        let c = Click {
            x: 1.,
            y: 2.,
            viewport: Viewport {
                width: 3.,
                height: 4.,
            },
        };
        assert_eq!(
            cdp_mouse_payload("mouseMoved", &c).unwrap()["pointerType"],
            "mouse"
        );
        assert_eq!(cdp_mouse_payload("mousePressed", &c).unwrap()["buttons"], 1);
        assert!(cdp_mouse_payload("mouseMoved", &Click { x: 3., ..c.clone() }).is_err());
        assert_eq!(iframe_offset((10., 20.), (3., 4.)), (13., 24.));
        assert_eq!(
            error_class(true, false, false, false),
            "immediate COM failure"
        );
    }
    #[test]
    fn diagnostic_schema_rejects_untrusted_shape() {
        assert!(diagnostic("{}").is_err());
        assert!(diagnostic(r#"{"event":"click","isTrusted":true,"x":1,"y":1,"button":0,"buttons":1,"pointerType":"mouse","pointerId":1,"timestamp":1,"url":"https://pockieninja.online/","origin":"https://evil.test","viewport":{"width":2,"height":2}}"#).is_err());
    }
}
