use crate::{
    models::{ClickButton, RecordedClick},
    platform,
};
use enigo::{Enigo, Mouse, Settings};
use rdev::{listen, Button as RdevButton, Event, EventType, Key};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Instant,
};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
struct RecordTiming {
    started: Option<Instant>,
    last_click: Option<Instant>,
}

#[derive(Clone)]
struct Hotkeys {
    record: String,
    playback: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            record: "Alt+Shift+R".into(),
            playback: "Alt+Shift+P".into(),
        }
    }
}

#[derive(Default)]
struct Latches {
    record: bool,
    playback: bool,
}

pub struct RuntimeState {
    pub recording: AtomicBool,
    pub playing: AtomicBool,
    pub stop_playback: AtomicBool,
    cursor: Mutex<(f64, f64)>,
    timing: Mutex<RecordTiming>,
    hotkeys: Mutex<Hotkeys>,
    pressed: Mutex<HashSet<String>>,
    latches: Mutex<Latches>,
    pub hud: Mutex<Option<crate::hud::HudWindowState>>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            recording: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            stop_playback: AtomicBool::new(false),
            cursor: Mutex::new((0.0, 0.0)),
            timing: Mutex::new(RecordTiming::default()),
            hotkeys: Mutex::new(Hotkeys::default()),
            pressed: Mutex::new(HashSet::new()),
            latches: Mutex::new(Latches::default()),
            hud: Mutex::new(None),
        }
    }
}

fn key_token(key: Key) -> Option<&'static str> {
    Some(match key {
        Key::Alt | Key::AltGr => "ALT",
        Key::ControlLeft | Key::ControlRight => "CTRL",
        Key::ShiftLeft | Key::ShiftRight => "SHIFT",
        Key::MetaLeft | Key::MetaRight => "META",
        Key::KeyA => "A",
        Key::KeyB => "B",
        Key::KeyC => "C",
        Key::KeyD => "D",
        Key::KeyE => "E",
        Key::KeyF => "F",
        Key::KeyG => "G",
        Key::KeyH => "H",
        Key::KeyI => "I",
        Key::KeyJ => "J",
        Key::KeyK => "K",
        Key::KeyL => "L",
        Key::KeyM => "M",
        Key::KeyN => "N",
        Key::KeyO => "O",
        Key::KeyP => "P",
        Key::KeyQ => "Q",
        Key::KeyR => "R",
        Key::KeyS => "S",
        Key::KeyT => "T",
        Key::KeyU => "U",
        Key::KeyV => "V",
        Key::KeyW => "W",
        Key::KeyX => "X",
        Key::KeyY => "Y",
        Key::KeyZ => "Z",
        Key::Num0 => "0",
        Key::Num1 => "1",
        Key::Num2 => "2",
        Key::Num3 => "3",
        Key::Num4 => "4",
        Key::Num5 => "5",
        Key::Num6 => "6",
        Key::Num7 => "7",
        Key::Num8 => "8",
        Key::Num9 => "9",
        Key::F1 => "F1",
        Key::F2 => "F2",
        Key::F3 => "F3",
        Key::F4 => "F4",
        Key::F5 => "F5",
        Key::F6 => "F6",
        Key::F7 => "F7",
        Key::F8 => "F8",
        Key::F9 => "F9",
        Key::F10 => "F10",
        Key::F11 => "F11",
        Key::F12 => "F12",
        Key::Space => "SPACE",
        Key::Return => "ENTER",
        Key::Escape => "ESC",
        _ => return None,
    })
}

fn hotkey_tokens(spec: &str) -> HashSet<String> {
    spec.split('+')
        .map(|s| s.trim().to_uppercase())
        .map(|s| match s.as_str() {
            "CONTROL" => "CTRL".to_string(),
            "COMMAND" | "CMD" | "WIN" | "SUPER" => "META".to_string(),
            "OPTION" => "ALT".to_string(),
            "RETURN" => "ENTER".to_string(),
            other => other.to_string(),
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn matches_hotkey(spec: &str, pressed: &HashSet<String>) -> bool {
    let wanted = hotkey_tokens(spec);
    !wanted.is_empty() && wanted.iter().all(|k| pressed.contains(k))
}

fn handle_key(app: &AppHandle, runtime: &RuntimeState, key: Key, down: bool) {
    let Some(token) = key_token(key) else {
        return;
    };
    let mut pressed = runtime.pressed.lock().unwrap();
    if down {
        pressed.insert(token.into());
    } else {
        pressed.remove(token);
    }
    let hotkeys = runtime.hotkeys.lock().unwrap().clone();
    let record_match = matches_hotkey(&hotkeys.record, &pressed);
    let play_match = matches_hotkey(&hotkeys.playback, &pressed);
    drop(pressed);

    let mut latches = runtime.latches.lock().unwrap();
    if record_match && !latches.record {
        latches.record = true;
        let _ = app.emit("hotkey-record", ());
    } else if !record_match {
        latches.record = false;
    }
    if play_match && !latches.playback {
        latches.playback = true;
        let _ = app.emit("hotkey-play", ());
    } else if !play_match {
        latches.playback = false;
    }
}

fn handle_event(app: &AppHandle, runtime: &RuntimeState, event: Event) {
    match event.event_type {
        EventType::MouseMove { x, y } => {
            *runtime.cursor.lock().unwrap() = (x, y);
        }
        EventType::ButtonPress(button @ (RdevButton::Left | RdevButton::Right)) => {
            if !runtime.recording.load(Ordering::SeqCst) || runtime.playing.load(Ordering::SeqCst) {
                return;
            }
            let snap = platform::foreground();
            if snap
                .title
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains("flowclicker")
            {
                return;
            }
            let (x, y) = *runtime.cursor.lock().unwrap();
            let now = Instant::now();
            let mut timing = runtime.timing.lock().unwrap();
            let base = timing.last_click.or(timing.started).unwrap_or(now);
            let delay = now.saturating_duration_since(base).as_millis() as u64;
            timing.last_click = Some(now);
            let sx = x.round() as i32;
            let sy = y.round() as i32;
            let (rx, ry) = match (snap.left, snap.top) {
                (Some(left), Some(top)) => (Some(sx - left), Some(sy - top)),
                _ => (None, None),
            };
            let click = RecordedClick {
                button: match button {
                    RdevButton::Right => ClickButton::Right,
                    RdevButton::Left => ClickButton::Left,
                    _ => unreachable!(),
                },
                screen_x: sx,
                screen_y: sy,
                relative_x: rx,
                relative_y: ry,
                window_title: snap.title,
                delay_ms: delay,
            };
            let _ = app.emit("recorded-click", click);
        }
        EventType::KeyPress(key) => handle_key(app, runtime, key, true),
        EventType::KeyRelease(key) => handle_key(app, runtime, key, false),
        _ => {}
    }
}

pub fn start_listener(app: AppHandle, runtime: Arc<RuntimeState>) {
    thread::spawn(move || {
        let app_for_cb = app.clone();
        let runtime_for_cb = runtime.clone();
        if let Err(err) = listen(move |event| handle_event(&app_for_cb, &runtime_for_cb, event)) {
            let _ = app.emit("input-listener-error", format!("{err:?}"));
        }
    });
}

pub fn start_recording(runtime: &RuntimeState) -> Result<(), String> {
    if runtime.playing.load(Ordering::SeqCst) {
        return Err("Stop playback before recording.".into());
    }
    if let Ok(enigo) = Enigo::new(&Settings::default()) {
        if let Ok((x, y)) = enigo.location() {
            *runtime.cursor.lock().unwrap() = (x as f64, y as f64);
        }
    }
    let now = Instant::now();
    *runtime.timing.lock().unwrap() = RecordTiming {
        started: Some(now),
        last_click: None,
    };
    runtime.recording.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn stop_recording(runtime: &RuntimeState) {
    runtime.recording.store(false, Ordering::SeqCst);
}

pub fn set_hotkeys(runtime: &RuntimeState, record: String, playback: String) {
    *runtime.hotkeys.lock().unwrap() = Hotkeys { record, playback };
}
