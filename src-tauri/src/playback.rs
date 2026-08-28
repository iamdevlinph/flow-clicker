use crate::{
    input::RuntimeState,
    models::{ClickButton, FlowAction, PlaybackOptions, RepeatMode, RepeatUnit},
    platform,
};
use enigo::{Button as EnigoButton, Coordinate, Direction, Enigo, Mouse, Settings};
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

fn enigo_button(button: ClickButton) -> EnigoButton {
    match button {
        ClickButton::Left => EnigoButton::Left,
        ClickButton::Right => EnigoButton::Right,
    }
}

fn should_stop(runtime: &RuntimeState, options: &PlaybackOptions, started: Instant) -> bool {
    runtime.stop_playback.load(Ordering::SeqCst)
        || (options.repeat_mode == RepeatMode::Duration
            && started.elapsed().as_millis() >= duration_limit_ms(options))
        || options
            .until_time
            .is_some_and(|deadline| now_epoch_ms() >= deadline)
}

fn interruptible_sleep(
    ms: u64,
    speed: f64,
    runtime: &RuntimeState,
    options: &PlaybackOptions,
    started: Instant,
) -> bool {
    if ms == 0 {
        return true;
    }
    let speed = playback_speed(speed);
    let actual = ((ms as f64) / speed).round().max(0.0) as u64;
    let wait_started = Instant::now();
    while wait_started.elapsed().as_millis() < actual as u128 {
        if should_stop(runtime, options, started) {
            return false;
        }
        thread::sleep(Duration::from_millis(
            (actual as u128 - wait_started.elapsed().as_millis()).min(10) as u64,
        ));
    }
    true
}

fn playback_speed(speed: f64) -> f64 {
    speed.clamp(1.0, 50.0)
}

fn duration_limit_ms(options: &PlaybackOptions) -> u128 {
    let mult: u128 = match options.repeat_unit {
        RepeatUnit::Minutes => 60_000,
        RepeatUnit::Hours => 3_600_000,
        RepeatUnit::Seconds => 1_000,
    };
    options.repeat_value as u128 * mult
}

fn execution_number(completed: u64) -> u64 {
    completed.saturating_add(1)
}

fn on_primary_monitor(
    x: i32,
    y: i32,
    origin_x: i32,
    origin_y: i32,
    width: u32,
    height: u32,
) -> bool {
    x >= origin_x
        && y >= origin_y
        && x < origin_x.saturating_add(width as i32)
        && y < origin_y.saturating_add(height as i32)
}

fn hide_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
}

fn show_click_effect(app: &AppHandle, x: i32, y: i32) {
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };
    let Ok(Some(monitor)) = overlay.primary_monitor() else {
        return;
    };
    let origin = *monitor.position();
    let size = *monitor.size();
    if !on_primary_monitor(x, y, origin.x, origin.y, size.width, size.height) {
        return;
    }
    if overlay
        .set_position(tauri::PhysicalPosition::new(origin.x, origin.y))
        .and_then(|_| overlay.set_size(tauri::PhysicalSize::new(size.width, size.height)))
        .and_then(|_| overlay.set_always_on_top(true))
        .and_then(|_| overlay.set_ignore_cursor_events(true))
        .and_then(|_| overlay.set_focusable(false))
        .is_err()
    {
        return;
    }
    if app
        .emit_to(
            "overlay",
            "playback-click",
            serde_json::json!({
                "mode": "playback", "screenX": x, "screenY": y, "originX": origin.x, "originY": origin.y
            }),
        )
        .is_err()
    {
        return;
    }
    let _ = overlay.show();
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
    if options.repeat_mode == RepeatMode::Clicks
        && actions.iter().map(FlowAction::click_count).sum::<u64>() == 0
    {
        return Err("Click-count playback requires at least one click.".into());
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
                hide_overlay(&app);
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
            let _ = app.emit(
                "playback-progress",
                serde_json::json!({"execution": execution_number(cycles), "clicks": click_count}),
            );
            for action in &actions {
                if should_stop(&runtime, &options, started)
                    || click_limit_reached(&options, click_count)
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
                    started,
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
                RepeatMode::Cycles | RepeatMode::Clicks | RepeatMode::Duration => {}
            }
            if should_stop(&runtime, &options, started) {
                break;
            }
        }

        if let Some((x, y)) = original_cursor {
            let _ = enigo.move_mouse(x, y, Coordinate::Abs);
        }
        hide_overlay(&app);
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
    started: Instant,
) -> bool {
    match action {
        FlowAction::Group {
            actions,
            repeat_count,
            ..
        } => {
            for _ in 0..*repeat_count {
                for child in actions {
                    if should_stop(runtime, options, started)
                        || click_limit_reached(options, *click_count)
                    {
                        return false;
                    }
                    if !play_action(enigo, child, options, runtime, app, click_count, started) {
                        return false;
                    }
                }
            }
            true
        }
        FlowAction::Delay { delay_ms, .. } => {
            interruptible_sleep(*delay_ms, options.speed, runtime, options, started)
        }
        FlowAction::Click {
            name,
            button,
            delay_ms,
            ..
        } => {
            if should_stop(runtime, options, started)
                || !interruptible_sleep(*delay_ms, options.speed, runtime, options, started)
            {
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
            if !interruptible_sleep(options.settle_ms, 1.0, runtime, options, started) {
                return false;
            }
            let button = enigo_button(*button);
            if enigo.button(button, Direction::Press).is_err() {
                let _ = app.emit(
                    "playback-error",
                    format!("Could not press mouse for action {name}"),
                );
                return false;
            }
            // Always release after a press, even when cancellation arrives during the hold.
            let _ = interruptible_sleep(options.hold_ms, 1.0, runtime, options, started);
            if enigo.button(button, Direction::Release).is_err() {
                let _ = app.emit(
                    "playback-error",
                    format!("Could not release mouse for action {name}"),
                );
                return false;
            }
            if runtime.stop_playback.load(Ordering::SeqCst) {
                return false;
            }
            *click_count += 1;
            show_click_effect(app, x, y);
            let _ = app.emit(
                "playback-progress",
                serde_json::json!({"clicks": *click_count}),
            );
            true
        }
    }
}

fn click_limit_reached(options: &PlaybackOptions, click_count: u64) -> bool {
    options.repeat_mode == RepeatMode::Clicks && click_count >= options.repeat_value.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::RuntimeState;

    fn options(until_time: Option<u64>) -> PlaybackOptions {
        PlaybackOptions {
            speed: 1.0,
            repeat_mode: RepeatMode::Cycles,
            repeat_value: 1,
            repeat_unit: RepeatUnit::Seconds,
            settle_ms: 0,
            hold_ms: 0,
            restore_cursor: false,
            focus_target_window: false,
            until_time,
        }
    }

    #[test]
    fn maps_left_and_right_buttons_for_enigo() {
        assert_eq!(enigo_button(ClickButton::Left), EnigoButton::Left);
        assert_eq!(enigo_button(ClickButton::Right), EnigoButton::Right);
    }

    #[test]
    fn expired_deadline_stops_before_first_child() {
        let runtime = RuntimeState::default();
        assert!(should_stop(&runtime, &options(Some(0)), Instant::now()));
    }

    #[test]
    fn cancellation_stops_waits() {
        let runtime = RuntimeState::default();
        runtime.stop_playback.store(true, Ordering::SeqCst);
        assert!(!interruptible_sleep(
            1000,
            1.0,
            &runtime,
            &options(None),
            Instant::now()
        ));
    }

    #[test]
    fn playback_speed_is_clamped_to_one_through_fifty() {
        assert_eq!(playback_speed(1.0), 1.0);
        assert_eq!(playback_speed(0.05), 1.0);
        assert_eq!(playback_speed(2.5), 2.5);
        assert_eq!(playback_speed(75.0), 50.0);
    }

    #[test]
    fn execution_starts_at_one_and_advances() {
        assert_eq!(execution_number(0), 1);
        assert_eq!(execution_number(2), 3);
    }

    #[test]
    fn click_effect_is_primary_monitor_only() {
        assert!(on_primary_monitor(100, 100, 0, 0, 1920, 1080));
        assert!(!on_primary_monitor(1920, 100, 0, 0, 1920, 1080));
        assert!(!on_primary_monitor(-1, 100, 0, 0, 1920, 1080));
    }
}
