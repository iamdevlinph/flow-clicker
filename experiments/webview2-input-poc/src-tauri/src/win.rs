use super::*;
use std::{sync::mpsc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        CallDevToolsProtocolMethodCompletedHandler, NavigationStartingEventHandler,
        NewWindowRequestedEventHandler, WebMessageReceivedEventHandler,
    },
    *,
};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

fn core(
    window: &tauri::WebviewWindow,
) -> Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2, String> {
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |view| {
            let mut webview = None;
            let result = unsafe { view.controller().CoreWebView2(&mut webview) }
                .map(|_| webview)
                .map_err(|e| e.to_string())
                .and_then(|v| v.ok_or_else(|| "CoreWebView2 unavailable".into()));
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "CoreWebView2 acquisition timed out".into())?
}

pub fn open_game(app: &AppHandle, script: &str, url: &str, profile: &str) -> Result<(), String> {
    if let Some(game) = app.get_webview_window("game") {
        game.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push(profile);
    let game = WebviewWindowBuilder::new(
        app,
        "game",
        WebviewUrl::External("about:blank".parse().map_err(|e| e.to_string())?),
    )
    .title("Game · Trusted Input POC")
    .visible(false)
    .data_directory(path)
    .build()
    .map_err(|e| e.to_string())?;
    install_game_handlers(
        &game,
        app.clone(),
        app.state::<Arc<State>>().inner().clone(),
    )?;
    let script = script.to_owned();
    let url = url.to_owned();
    let reveal = game.clone();
    let (tx, rx) = mpsc::channel();
    game.with_webview(move |view| unsafe {
        let mut webview = None;
        let result = view
            .controller()
            .CoreWebView2(&mut webview)
            .map_err(|error| error.to_string())
            .and_then(|_| webview.ok_or_else(|| "CoreWebView2 unavailable".into()))
            .and_then(|webview| {
                let next = webview.clone();
                let destination = HSTRING::from(url);
                webview
                    .AddScriptToExecuteOnDocumentCreated(
                        &HSTRING::from(script),
                        &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                            move |error, _| {
                                error?;
                                next.Navigate(&destination)?;
                                reveal
                                    .show()
                                    .map_err(|_| windows::core::Error::from_win32())?;
                                Ok(())
                            },
                        )),
                    )
                    .map_err(|error| error.to_string())
            });
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Diagnostic installation timed out".to_string())?
}

pub fn install_handlers(
    _app: AppHandle,
    _state: Arc<State>,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn install_game_handlers(
    game: &tauri::WebviewWindow,
    app: AppHandle,
    state: Arc<State>,
) -> Result<(), String> {
    let webview = core(game)?;
    unsafe {
        let mut token = EventRegistrationToken::default();
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
                    let event = serde_json::to_string(&parsed["event"])
                        .map_err(|_| windows::core::Error::from_win32())?;
                    let event = match accept_diagnostic("flowclicker-diagnostic", &source, &event) {
                        Ok(event) => event,
                        Err(_) => return Ok(()),
                    };
                    let replaying = state2.replay_active.lock().map(|v| *v).unwrap_or(false);
                    if replaying {
                        if let Ok(mut events) = state2.replay_events.lock() {
                            events.push(event.clone());
                            events.truncate(256);
                        }
                    } else if state2.capture_armed.lock().map(|v| *v).unwrap_or(false) {
                        if event.event == "click" {
                            if let Ok(mut click) = state2.last_click.lock() {
                                *click = Some(Click {
                                    x: event.x,
                                    y: event.y,
                                    viewport: event.viewport.clone(),
                                });
                            }
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

async fn call_cdp(
    window: &tauri::WebviewWindow,
    method: &str,
    params: Value,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let method = HSTRING::from(method);
    let params = HSTRING::from(params.to_string());
    window
        .with_webview(move |view| unsafe {
            let callback_sender = sender.clone();
            let mut webview = None;
            let answer = view
                .controller()
                .CoreWebView2(&mut webview)
                .map_err(|e| format!("immediate COM failure: {e}"))
                .and_then(|_| {
                    webview.ok_or_else(|| "immediate COM failure: CoreWebView2 unavailable".into())
                })
                .and_then(|webview| {
                    webview
                        .CallDevToolsProtocolMethod(
                            &method,
                            &params,
                            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                                move |error, result| {
                                    let answer = match (error, result) {
                                        (Ok(()), Some(value)) => {
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
                                        (Err(e), _) => {
                                            Err(format!("completion callback failure: {e}"))
                                        }
                                        (_, None) => {
                                            Err("completion callback failure: missing result"
                                                .into())
                                        }
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
        .map_err(|_| "completion callback failure: channel closed".into())?
}

pub async fn replay(
    app: &AppHandle,
    state: &Arc<State>,
    click: Click,
    settle: u64,
    hold: u64,
) -> Result<ReplayResult, String> {
    let game = app
        .get_webview_window("game")
        .ok_or("Game window is not open")?;
    let mut before = POINT::default();
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
    *state
        .replay_active
        .lock()
        .map_err(|_| "State lock failed")? = true;
    let mut cdp = Vec::new();
    for (kind, wait) in [
        ("mouseMoved", settle),
        ("mousePressed", hold),
        ("mouseReleased", 0),
    ] {
        let result = call_cdp(
            &game,
            "Input.dispatchMouseEvent",
            cdp_mouse_payload(kind, &click)?,
        )
        .await;
        match result {
            Ok(value) => cdp.push(value),
            Err(error) => {
                *state
                    .replay_active
                    .lock()
                    .map_err(|_| "State lock failed")? = false;
                return Err(error);
            }
        }
        if wait > 0 {
            tokio::time::sleep(Duration::from_millis(wait)).await;
        }
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    *state
        .replay_active
        .lock()
        .map_err(|_| "State lock failed")? = false;
    let mut after = POINT::default();
    unsafe {
        GetCursorPos(&mut after).map_err(|e| e.to_string())?;
    }
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
        cdp,
        physical_events,
        replay_events,
    })
}

pub async fn self_test(window: &tauri::WebviewWindow) -> Result<SelfTestResult, String> {
    let valid = call_cdp(
        window,
        "Runtime.evaluate",
        serde_json::json!({"expression":"1+1","returnByValue":true}),
    )
    .await?;
    let invalid = call_cdp(window, "FlowClicker.invalidMethod", serde_json::json!({}))
        .await
        .unwrap_or_else(|error| error);
    Ok(SelfTestResult { valid, invalid })
}
