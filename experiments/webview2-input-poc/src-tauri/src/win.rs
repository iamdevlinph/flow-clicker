use super::*;
use serde_json::Value;
use std::{
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
    WindowEvent,
};
use webview2_com::{
    AddScriptToExecuteOnDocumentCreatedCompletedHandler,
    CallDevToolsProtocolMethodCompletedHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2,
    NavigationStartingEventHandler, NewWindowRequestedEventHandler, WebMessageReceivedEventHandler,
};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    IsWindowVisible, WindowFromPoint, GA_PARENT, GWL_EXSTYLE, GWL_STYLE, WS_DISABLED,
    WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

fn open_game(app: &AppHandle) -> Result<(), String> {
    let game = app.get_webview("game").ok_or("Game webview is not open")?;
    let (tx, rx) = mpsc::channel();
    game.with_webview(move |view| {
        let result = unsafe {
            view.controller()
                .CoreWebView2()
                .and_then(|webview| webview.Navigate(&HSTRING::from(GAME_URL)))
        }
        .map_err(|e| e.to_string());
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Navigation timed out")??;
    game.show().map_err(|e| e.to_string())
}

pub fn install_handlers(
    app: AppHandle,
    state: Arc<State>,
    init_script: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let game_window = app.get_window("game").ok_or("Game window is not open")?;
    game_window.set_size(LogicalSize::new(GAME_VIEWPORT_WIDTH, GAME_VIEWPORT_HEIGHT))?;
    game_window.set_resizable(false)?;
    game_window.add_child(
        WebviewBuilder::new(CONTROL, WebviewUrl::App("index.html?target=browser".into()))
            .initialization_script("window.__FLOWCLICKER_TARGET__ = 'browser';"),
        LogicalPosition::new(20, 20),
        LogicalSize::new(CONTROL_WIDTH, CONTROL_HEIGHT),
    )?;
    let game = app.get_webview("game").ok_or("Game webview is not open")?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay window is not open")?;
    overlay.set_ignore_cursor_events(true)?;
    overlay.set_focusable(false)?;
    align_overlay(&game_window, &overlay)?;
    overlay.hide()?;
    game_window.show()?;
    install_game_handlers(&game, app.clone(), state, init_script)?;
    let overlay_for_resize = overlay.clone();
    let game_for_resize = game_window.clone();
    game_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            let _ = overlay_for_resize.close();
            return;
        }
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let _ = game_for_resize
                .set_size(LogicalSize::new(GAME_VIEWPORT_WIDTH, GAME_VIEWPORT_HEIGHT));
        }
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let _ = align_overlay(&game_for_resize, &overlay_for_resize);
        }
    });
    open_game(&app)?;
    Ok(())
}

fn install_game_handlers(
    game: &tauri::Webview,
    app: AppHandle,
    state: Arc<State>,
    init_script: String,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    game.with_webview(move |view| {
        let result = unsafe {
            view.controller()
                .SetZoomFactor(1.0)
                .and_then(|_| view.controller().CoreWebView2())
        }
        .map_err(|e| e.to_string())
        .and_then(|webview| install_game_handlers_core(webview, app, state, init_script));
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Handler installation timed out")?
}

fn install_game_handlers_core(
    webview: ICoreWebView2,
    app: AppHandle,
    state: Arc<State>,
    init_script: String,
) -> Result<(), String> {
    unsafe {
        let mut token = 0i64;
        webview
            .Settings()
            .and_then(|settings| {
                settings.SetAreDefaultContextMenusEnabled(false)?;
                settings.SetIsZoomControlEnabled(false)
            })
            .map_err(|e| e.to_string())?;
        webview
            .AddScriptToExecuteOnDocumentCreated(
                &HSTRING::from(init_script),
                &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                    |error, _| error,
                )),
            )
            .map_err(|e| e.to_string())?;
        webview
            .add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let value = uri.to_string().unwrap_or_default();
                        if value != "about:blank" && !allowed_navigation(&value) {
                            args.SetCancel(true)?;
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|e| e.to_string())?;
        webview
            .add_NewWindowRequested(
                &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        args.SetHandled(true)?;
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|e| e.to_string())?;
        let app2 = app.clone();
        let state2 = state.clone();
        webview
            .add_WebMessageReceived(
                &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut source = PWSTR::null();
                    args.Source(&mut source)?;
                    let source = source.to_string().unwrap_or_default();
                    let mut raw = PWSTR::null();
                    args.TryGetWebMessageAsString(&mut raw)?;
                    let body = raw.to_string().unwrap_or_default();
                    let parsed: Value = match serde_json::from_str(&body) {
                        Ok(value) => value,
                        Err(_) => return Ok(()),
                    };
                    if parsed["channel"] != "flowclicker-diagnostic" {
                        return Ok(());
                    }
                    if parsed["token"].as_str() != Some(&state2.message_token) {
                        return Ok(());
                    }
                    let event = serde_json::to_string(&parsed["event"])
                        .map_err(|_| windows::core::Error::from_win32())?;
                    let event = match accept_diagnostic("flowclicker-diagnostic", &source, &event) {
                        Ok(event) => event,
                        Err(_) => return Ok(()),
                    };
                    let replaying = state2.playback.lock().map(|v| v.active).unwrap_or(false);
                    let record_hotkey = state2
                        .record_hotkey
                        .lock()
                        .map(|v| v.clone())
                        .unwrap_or_default();
                    let playback_hotkey = state2
                        .playback_hotkey
                        .lock()
                        .map(|v| v.clone())
                        .unwrap_or_default();
                    if let Some(command) = hotkey_command(&event, &record_hotkey, &playback_hotkey)
                    {
                        let _ = app2.emit_to(
                            "control",
                            if command == "record" {
                                "hotkey-record"
                            } else {
                                "hotkey-play"
                            },
                            (),
                        );
                        return Ok(());
                    }
                    if replaying {
                        if let Ok(mut events) = state2.replay_events.lock() {
                            events.push(event.clone());
                            events.truncate(256);
                        }
                    } else if state2.capture_armed.lock().map(|v| *v).unwrap_or(false) {
                        if let Some(button) = recorded_button(&event) {
                            let delay_ms = state2
                                .last_capture_timestamp
                                .lock()
                                .ok()
                                .and_then(|mut previous| {
                                    let delay = previous
                                        .map(|value| (event.timestamp - value).max(0.0) as u64)
                                        .unwrap_or(0);
                                    *previous = Some(event.timestamp);
                                    Some(delay)
                                })
                                .unwrap_or(0);
                            if let Ok(mut click) = state2.last_click.lock() {
                                *click = Some(Click {
                                    action_id: None,
                                    x: event.x,
                                    y: event.y,
                                    viewport: event.viewport.clone(),
                                    button: button.into(),
                                    delay_ms,
                                });
                            }
                            let _ = app2.emit_to(
                                "control",
                                "recorded-click",
                                serde_json::json!({
                                    "x": event.x,
                                    "y": event.y,
                                    "viewportWidth": event.viewport.width,
                                    "viewportHeight": event.viewport.height,
                                    "button": button,
                                    "delayMs": delay_ms
                                }),
                            );
                        }
                        if let Ok(mut events) = state2.physical_events.lock() {
                            events.push(event.clone());
                            events.truncate(256);
                        }
                        let _ = app2.emit_to("control", "physical-diagnostic", event);
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn arm_capture(state: Arc<State>) -> Result<(), String> {
    *state
        .capture_armed
        .lock()
        .map_err(|_| "State lock failed")? = true;
    Ok(())
}

fn align_overlay(game: &tauri::Window, overlay: &tauri::WebviewWindow) -> tauri::Result<()> {
    let position = game.inner_position()?;
    let size = game.inner_size()?;
    overlay.set_position(position)?;
    overlay.set_size(size)
}

async fn call_cdp(window: &tauri::Webview, method: &str, params: Value) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let method = HSTRING::from(method);
    let params = HSTRING::from(params.to_string());
    window
        .with_webview(move |view| unsafe {
            let callback_sender = sender.clone();
            let answer = view
                .controller()
                .CoreWebView2()
                .map_err(|e| format!("immediate COM failure: {e}"))
                .and_then(|webview| {
                    webview
                        .CallDevToolsProtocolMethod(
                            &method,
                            &params,
                            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                                move |error, result| {
                                    let answer = match error {
                                        Ok(()) => {
                                            let value = result;
                                            match serde_json::from_str::<Value>(&value.to_string())
                                            {
                                                Ok(json) if json.get("error").is_some() => {
                                                    Err(format!("CDP error object: {json}"))
                                                }
                                                Ok(_) => Ok(value.to_string()),
                                                Err(error) => {
                                                    Err(format!("malformed JSON: {error}"))
                                                }
                                            }
                                        }
                                        Err(e) => Err(format!("completion callback failure: {e}")),
                                    };
                                    if let Some(tx) =
                                        callback_sender.lock().ok().and_then(|mut tx| tx.take())
                                    {
                                        let _ = tx.send(answer);
                                    }
                                    Ok(())
                                },
                            )),
                        )
                        .map_err(|e| format!("immediate COM failure: {e}"))
                });
            if let Err(error) = answer {
                if let Some(tx) = sender.lock().ok().and_then(|mut tx| tx.take()) {
                    let _ = tx.send(Err(error));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "completion callback failure: channel closed".to_string())?
}

pub async fn replay(
    app: &AppHandle,
    state: &Arc<State>,
    click: Click,
    start_delay: u64,
    settle: u64,
    hold: u64,
) -> Result<ReplayResult, String> {
    replay_owned(app, state, click, start_delay, settle, hold, false).await
}

pub async fn play_browser_flow(
    app: &AppHandle,
    state: &Arc<State>,
    actions: Vec<Click>,
    repeat_mode: &str,
    repeat_value: u64,
    speed: f64,
    settle_ms: u64,
    hold_ms: u64,
    trailing_delay_ms: u64,
    until_time: Option<u64>,
) -> Result<(), String> {
    let game = app.get_webview("game").ok_or("Game window is not open")?;
    let game_window = app.get_window("game").ok_or("Game window is not open")?;
    let origin = game_window.inner_position().map_err(|e| e.to_string())?;
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.set_focusable(false);
        let _ = overlay.show();
    }
    let deadline = if repeat_mode == "duration" {
        Some(std::time::Instant::now() + Duration::from_secs(repeat_value))
    } else {
        until_time.map(|value| {
            std::time::Instant::now() + Duration::from_millis(value.saturating_sub(now_epoch_ms()))
        })
    };
    let speed = speed.clamp(1.0, 50.0);
    let repeat_count = if repeat_mode == "cycles" {
        repeat_value
    } else {
        u64::MAX
    };
    'playback: for execution in 1..=repeat_count {
        if deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline) {
            break;
        }
        for click in &actions {
            if !cancellable_delay_until(state, scaled_delay(click.delay_ms, speed), deadline)
                .await?
            {
                break 'playback;
            }
            if cancelled(state) {
                return Err("Playback stopped".into());
            }
            if !cancellable_delay_until(state, settle_ms, deadline).await? {
                break 'playback;
            }
            call_cdp(
                &game,
                "Input.dispatchMouseEvent",
                cdp_mouse_payload("mouseMoved", click)?,
            )
            .await?;
            let _ = app.emit_to("overlay", "playback-click", serde_json::json!({
                "mode":"playback", "screenX":origin.x as f64 + click.x, "screenY":origin.y as f64 + click.y, "originX":origin.x, "originY":origin.y
            }));
            call_cdp(
                &game,
                "Input.dispatchMouseEvent",
                cdp_mouse_payload("mousePressed", click)?,
            )
            .await?;
            let hold = hold_ms;
            let mut elapsed = 0;
            while elapsed < hold {
                tokio::time::sleep(Duration::from_millis((hold - elapsed).min(10))).await;
                elapsed += (hold - elapsed).min(10);
                if cancelled(state) {
                    let _ = call_cdp(
                        &game,
                        "Input.dispatchMouseEvent",
                        cdp_mouse_payload("mouseReleased", click)?,
                    )
                    .await;
                    return Err("Playback stopped".into());
                }
                if deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline) {
                    let _ = call_cdp(
                        &game,
                        "Input.dispatchMouseEvent",
                        cdp_mouse_payload("mouseReleased", click)?,
                    )
                    .await;
                    break 'playback;
                }
            }
            call_cdp(
                &game,
                "Input.dispatchMouseEvent",
                cdp_mouse_payload("mouseReleased", click)?,
            )
            .await?;
        }
        if !cancellable_delay_until(state, scaled_delay(trailing_delay_ms, speed), deadline).await?
        {
            break;
        }
        let _ = app.emit_to(
            CONTROL,
            "playback-progress",
            serde_json::json!({"execution": execution}),
        );
    }
    Ok(())
}

fn scaled_delay(ms: u64, speed: f64) -> u64 {
    ((ms as f64) / speed.clamp(1.0, 50.0)).round() as u64
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

async fn replay_owned(
    app: &AppHandle,
    state: &Arc<State>,
    click: Click,
    start_delay: u64,
    settle: u64,
    hold: u64,
    owned: bool,
) -> Result<ReplayResult, String> {
    let game = app.get_webview("game").ok_or("Game window is not open")?;
    if !owned {
        begin_replay(state)?;
    }
    if let Err(error) = cancellable_delay(state, start_delay.max(click.delay_ms)).await {
        if !owned {
            finish_replay(state);
        }
        return Err(error);
    }
    if cancelled(state) {
        finish_replay(state);
        return Err("Replay stopped".into());
    }
    let mut before = POINT::default();
    let foreground_before = unsafe { GetForegroundWindow().0 as isize };
    unsafe {
        GetCursorPos(&mut before).map_err(|e| e.to_string())?;
    }
    state
        .replay_events
        .lock()
        .map_err(|_| "State lock failed")?
        .clear();
    *state
        .capture_armed
        .lock()
        .map_err(|_| "State lock failed")? = false;
    let mut cdp = Vec::new();
    let mut pressed = false;
    let mut stop_after_release = false;
    for (kind, wait) in [
        ("mouseMoved", settle),
        ("mousePressed", hold),
        ("mouseReleased", 0),
    ] {
        if cancelled(state) && !pressed {
            break;
        }
        let result = call_cdp(
            &game,
            "Input.dispatchMouseEvent",
            cdp_mouse_payload(kind, &click)?,
        )
        .await;
        match result {
            Ok(value) => {
                pressed = kind == "mousePressed" || pressed && kind != "mouseReleased";
                cdp.push(value)
            }
            Err(error) => {
                if pressed {
                    let _ = call_cdp(
                        &game,
                        "Input.dispatchMouseEvent",
                        cdp_mouse_payload("mouseReleased", &click)?,
                    )
                    .await;
                }
                if !owned {
                    finish_replay(state);
                }
                return Err(error);
            }
        }
        if wait > 0 {
            if kind == "mousePressed" {
                let mut elapsed = 0;
                while elapsed < wait {
                    let step = (wait - elapsed).min(50);
                    tokio::time::sleep(Duration::from_millis(step)).await;
                    elapsed += step;
                    if cancelled(state) {
                        stop_after_release = true;
                        break;
                    }
                }
            } else if let Err(error) = cancellable_delay(state, wait).await {
                if !owned {
                    finish_replay(state);
                }
                return Err(error);
            }
        }
        if kind == "mouseReleased" && stop_after_release {
            if !owned {
                finish_replay(state);
            }
            return Err("Replay stopped".into());
        }
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    if !owned {
        finish_replay(state);
    }
    let mut after = POINT::default();
    unsafe {
        GetCursorPos(&mut after).map_err(|e| e.to_string())?;
    }
    let foreground_after = unsafe { GetForegroundWindow().0 as isize };
    let physical_events = state
        .physical_events
        .lock()
        .map_err(|_| "State lock failed")?
        .clone();
    let replay_events = state
        .replay_events
        .lock()
        .map_err(|_| "State lock failed")?
        .clone();
    Ok(ReplayResult {
        cursor_before: [before.x, before.y],
        cursor_after: [after.x, after.y],
        cursor_moved: before.x != after.x || before.y != after.y,
        foreground_before,
        foreground_after,
        cdp,
        physical_events,
        replay_events,
        activation: "operator confirmation required".into(),
    })
}

async fn cancellable_delay(state: &State, total: u64) -> Result<(), String> {
    cancellable_delay_until(state, total, None)
        .await
        .map(|_| ())
}

async fn cancellable_delay_until(
    state: &State,
    total: u64,
    deadline: Option<std::time::Instant>,
) -> Result<bool, String> {
    let mut elapsed = 0;
    while elapsed < total {
        if cancelled(state) {
            return Err("Replay stopped".into());
        }
        if deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline) {
            return Ok(false);
        }
        let step = (total - elapsed).min(50);
        tokio::time::sleep(Duration::from_millis(step)).await;
        elapsed += step;
    }
    Ok(!deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline))
}

pub async fn self_test(window: &tauri::Webview) -> Result<SelfTestResult, String> {
    let valid = call_cdp(
        window,
        "Runtime.evaluate",
        serde_json::json!({"expression":"1+1","returnByValue":true}),
    )
    .await?;
    let parsed: Value =
        serde_json::from_str(&valid).map_err(|error| format!("malformed JSON: {error}"))?;
    let value = parsed
        .pointer("/result/value")
        .and_then(Value::as_i64)
        .ok_or("malformed JSON: Runtime.evaluate value missing")?;
    if value != 2 {
        return Err(format!("CDP value mismatch: expected 2, got {value}"));
    }
    let invalid = call_cdp(window, "FlowClicker.invalidMethod", serde_json::json!({}))
        .await
        .unwrap_or_else(|error| error);
    Ok(SelfTestResult { value, invalid })
}

pub async fn host_diagnostics(app: &AppHandle) -> Result<HostDiagnostics, String> {
    let game = app.get_webview("game").ok_or("Game window is not open")?;
    let runtime: Value =
        serde_json::from_str(&call_cdp(&game, "Browser.getVersion", serde_json::json!({})).await?)
            .map_err(|e| format!("malformed JSON: {e}"))?;
    let page: Value = serde_json::from_str(&call_cdp(&game, "Runtime.evaluate", serde_json::json!({"expression":"({url:location.href,viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,visibility:document.visibilityState})","returnByValue":true})).await?).map_err(|e| format!("malformed JSON: {e}"))?;
    let value = page.pointer("/result/value").cloned().unwrap_or_default();
    let hwnd = game.window().hwnd().map_err(|e| e.to_string())?;
    let native = HWND(hwnd.0);
    let mut rect = RECT::default();
    let mut cursor = POINT::default();
    unsafe {
        GetWindowRect(native, &mut rect).map_err(|e| e.to_string())?;
        GetCursorPos(&mut cursor).map_err(|e| e.to_string())?;
    }
    let (tx, rx) = mpsc::channel();
    game.with_webview(move |view| {
        let mut bounds = RECT::default();
        let mut zoom = 0.0;
        let result = unsafe {
            view.controller()
                .Bounds(&mut bounds)
                .and_then(|_| view.controller().ZoomFactor(&mut zoom))
                .and_then(|_| view.controller().CoreWebView2())
        }
        .map(|_| (bounds, zoom, true))
        .map_err(|e| e.to_string());
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    let (controller_bounds, controller_zoom, core_webview2_available) = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Controller bounds timed out")??;
    let style = unsafe { GetWindowLongPtrW(native, GWL_STYLE) };
    let ex_style = unsafe { GetWindowLongPtrW(native, GWL_EXSTYLE) };
    let hit = unsafe { WindowFromPoint(cursor) };
    let mut ancestors = Vec::new();
    let mut current = hit;
    while current.0 != std::ptr::null_mut() && ancestors.len() < 16 {
        ancestors.push(current.0 as isize);
        current = unsafe { GetAncestor(current, GA_PARENT) };
    }
    Ok(HostDiagnostics {
        runtime_version: runtime
            .pointer("/product")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        url: sanitize_url(value.get("url").and_then(Value::as_str).unwrap_or_default()),
        viewport: value
            .get("viewport")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok()),
        device_pixel_ratio: value.get("dpr").and_then(Value::as_f64),
        zoom: Some(controller_zoom),
        visibility_state: value
            .get("visibility")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        hwnd: hwnd.0 as isize,
        controller_available: true,
        core_webview2_available,
        window_rect: [rect.left, rect.top, rect.right, rect.bottom],
        controller_bounds: [
            controller_bounds.left,
            controller_bounds.top,
            controller_bounds.right,
            controller_bounds.bottom,
        ],
        visible: unsafe { IsWindowVisible(native).as_bool() },
        enabled: unsafe { IsWindowEnabled(native).as_bool() },
        style,
        ex_style,
        focusable: style & WS_DISABLED.0 as isize == 0,
        opaque: ex_style & WS_EX_LAYERED.0 as isize == 0,
        ignores_cursor_events: ex_style & WS_EX_TRANSPARENT.0 as isize != 0,
        foreground_hwnd: unsafe { GetForegroundWindow().0 as isize },
        cursor: [cursor.x, cursor.y],
        window_from_point: hit.0 as isize,
        ancestor_chain: ancestors,
    })
}

pub async fn replay_loop(
    app: AppHandle,
    state: Arc<State>,
    click: Click,
    start_delay: u64,
    interval: u64,
) {
    if cancellable_delay(&state, start_delay).await.is_err() {
        finish_replay(&state);
        return;
    }
    while !cancelled(&state) {
        if replay_owned(&app, &state, click.clone(), 0, 0, 30, true)
            .await
            .is_err()
        {
            break;
        }
        if cancellable_delay(&state, interval).await.is_err() {
            break;
        }
    }
    finish_replay(&state);
}
