use crate::{
    models::{FlowAction, PlaybackOptions, RecordedClick, RepeatMode, RepeatUnit},
    platform,
};
use enigo::{Button as EnigoButton, Coordinate, Direction, Enigo, Mouse, Settings};
use rdev::{listen, Button as RdevButton, Event, EventType, Key};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
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
        EventType::ButtonPress(RdevButton::Left) => {
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

// Playback lives in playback.rs. Keep this disabled compatibility copy out of the build
// while preserving the bounded diff for users with older local branches.
#[cfg(any())]
mod legacy_playback {
    fn interruptible_sleep(ms: u64, speed: f64, stop: &AtomicBool) -> bool {
        if ms == 0 {
            return true;
        }
        let speed = speed.clamp(0.05, 50.0);
        let actual = ((ms as f64) / speed).round().max(0.0) as u64;
        let started = Instant::now();
        while started.elapsed().as_millis() < actual as u128 {
            if stop.load(Ordering::SeqCst) {
                return false;
            }
            thread::sleep(Duration::from_millis(
                (actual as u128 - started.elapsed().as_millis()).min(10) as u64,
            ));
        }
        true
    }

    fn duration_limit_ms(options: &PlaybackOptions) -> u128 {
        let mult: u128 = match options.repeat_unit {
            RepeatUnit::Minutes => 60_000,
            RepeatUnit::Hours => 3_600_000,
            RepeatUnit::Seconds => 1_000,
        };
        options.repeat_value as u128 * mult
    }

    pub fn play(
        app: AppHandle,
        runtime: Arc<RuntimeState>,
        actions: Vec<FlowAction>,
        options: PlaybackOptions,
    ) -> Result<(), String> {
        if actions.is_empty() {
            return Err("The selected flow has no actions.".into());
        }
        if runtime.playing.swap(true, Ordering::SeqCst) {
            return Err("A flow is already playing.".into());
        }
        runtime.recording.store(false, Ordering::SeqCst);
        runtime.stop_playback.store(false, Ordering::SeqCst);

        thread::spawn(move || {
            let mut enigo = match Enigo::new(&Settings::default()) {
                Ok(v) => v,
                Err(e) => {
                    runtime.playing.store(false, Ordering::SeqCst);
                    let _ = app.emit(
                        "playback-error",
                        format!("Could not initialize native mouse input: {e}"),
                    );
                    return;
                }
            };
            let original_cursor = if options.restore_cursor {
                enigo.location().ok()
            } else {
                None
            };
            let started = Instant::now();
            let mut cycles = 0u64;
            let mut click_count = 0u64;
            let _ = app.emit("playback-state", "playing");

            'outer: loop {
                for action in &actions {
                    if runtime.stop_playback.load(Ordering::SeqCst) {
                        break 'outer;
                    }
                    if options.repeat_mode == RepeatMode::Duration
                        && started.elapsed().as_millis() >= duration_limit_ms(&options)
                    {
                        break 'outer;
                    }
                    if !play_action(
                        &mut enigo,
                        action,
                        &options,
                        &runtime,
                        &app,
                        &mut click_count,
                    ) {
                        break 'outer;
                    }
                }
                cycles += 1;
                match options.repeat_mode {
                    RepeatMode::Cycles if cycles >= options.repeat_value.max(1) => break,
                    RepeatMode::Clicks if click_count >= options.repeat_value.max(1) => break,
                    RepeatMode::Duration
                        if started.elapsed().as_millis() >= duration_limit_ms(&options) =>
                    {
                        break
                    }
                    RepeatMode::Continuous => {}
                }
                if options
                    .until_time
                    .is_some_and(|deadline| now_epoch_ms() >= deadline)
                {
                    break;
                }
            }

            if let Some((x, y)) = original_cursor {
                let _ = enigo.move_mouse(x, y, Coordinate::Abs);
            }
            runtime.playing.store(false, Ordering::SeqCst);
            runtime.stop_playback.store(false, Ordering::SeqCst);
            let _ = app.emit("playback-state", "stopped");
        });
        Ok(())
    }

    fn now_epoch_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn play_action(
        enigo: &mut Enigo,
        action: &FlowAction,
        options: &PlaybackOptions,
        runtime: &RuntimeState,
        app: &AppHandle,
        click_count: &mut u64,
    ) -> bool {
        match action {
            FlowAction::Group {
                actions,
                repeat_count,
                ..
            } => {
                for _ in 0..*repeat_count {
                    for child in actions {
                        if !play_action(enigo, child, options, runtime, app, click_count) {
                            return false;
                        }
                    }
                }
                true
            }
            FlowAction::Delay { delay_ms, .. } => {
                interruptible_sleep(*delay_ms, options.speed, &runtime.stop_playback)
            }
            FlowAction::Click { name, delay_ms, .. } => {
                if !interruptible_sleep(*delay_ms, options.speed, &runtime.stop_playback) {
                    return false;
                }
                if options.repeat_mode == RepeatMode::Clicks
                    && *click_count >= options.repeat_value.max(1)
                {
                    return false;
                }
                let click = action.as_click().expect("click action");
                let (x, y) = platform::resolve(&click, options.focus_target_window);
                if enigo.move_mouse(x, y, Coordinate::Abs).is_err() {
                    let _ = app.emit(
                        "playback-error",
                        format!("Could not move mouse for action {name}"),
                    );
                    return false;
                }
                if !interruptible_sleep(options.settle_ms, 1.0, &runtime.stop_playback) {
                    return false;
                }
                if enigo.button(EnigoButton::Left, Direction::Press).is_err() {
                    let _ = app.emit(
                        "playback-error",
                        format!("Could not press mouse for action {name}"),
                    );
                    return false;
                }
                // Always release after a press, even when cancellation arrives during the hold.
                let _ = interruptible_sleep(options.hold_ms, 1.0, &runtime.stop_playback);
                let _ = enigo.button(EnigoButton::Left, Direction::Release);
                if runtime.stop_playback.load(Ordering::SeqCst) {
                    return false;
                }
                *click_count += 1;
                let _ = app.emit(
                    "playback-progress",
                    serde_json::json!({"clicks": *click_count}),
                );
                true
            }
        }
    }
}
