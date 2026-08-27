use crate::input::RuntimeState;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Size};

const HUD_WIDTH: u32 = 220;
const HUD_HEIGHT: u32 = 36;

#[derive(Clone, Copy)]
pub struct HudWindowState {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    decorated: bool,
    resizable: bool,
    always_on_top: bool,
}

fn clamp_position_in_area(
    position: PhysicalPosition<i32>,
    area_position: PhysicalPosition<i32>,
    area_size: PhysicalSize<u32>,
    width: i32,
    height: i32,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        position.x.clamp(
            area_position.x,
            (area_position.x + area_size.width as i32 - width).max(area_position.x),
        ),
        position.y.clamp(
            area_position.y,
            (area_position.y + area_size.height as i32 - height).max(area_position.y),
        ),
    )
}

fn clamp_position(
    position: PhysicalPosition<i32>,
    monitor: &tauri::Monitor,
    scale: f64,
) -> PhysicalPosition<i32> {
    let area = monitor.work_area();
    let width = (HUD_WIDTH as f64 * scale).round() as i32;
    let height = (HUD_HEIGHT as f64 * scale).round() as i32;
    clamp_position_in_area(position, area.position, area.size, width, height)
}

fn needs_transition(active: bool, hud_active: bool) -> bool {
    active != hud_active
}

pub fn set_playback_hud(
    app: &AppHandle,
    runtime: &RuntimeState,
    active: bool,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    if !needs_transition(active, runtime.hud.lock().unwrap().is_some()) {
        return Ok(());
    }
    if active {
        let original = HudWindowState {
            position: main.outer_position().map_err(|e| e.to_string())?,
            size: main.inner_size().map_err(|e| e.to_string())?,
            decorated: main.is_decorated().unwrap_or(true),
            resizable: main.is_resizable().unwrap_or(false),
            always_on_top: main.is_always_on_top().unwrap_or(false),
        };
        let monitor = main
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("No current monitor found")?;
        let scale = main.scale_factor().unwrap_or(1.0).max(0.1);
        let position = clamp_position(original.position, &monitor, scale);
        let result = (|| {
            if let Some(editor) = app.get_window("editor") {
                let _ = editor.hide();
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
            }
            main.set_decorations(false).map_err(|e| e.to_string())?;
            main.set_resizable(false).map_err(|e| e.to_string())?;
            main.set_focusable(false).map_err(|e| e.to_string())?;
            main.set_ignore_cursor_events(true)
                .map_err(|e| e.to_string())?;
            main.set_always_on_top(true).map_err(|e| e.to_string())?;
            main.set_size(Size::Logical(LogicalSize::new(
                HUD_WIDTH as f64,
                HUD_HEIGHT as f64,
            )))
            .map_err(|e| e.to_string())?;
            main.set_position(position).map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        if let Err(error) = result {
            let _ = restore(&main, original);
            return Err(error);
        }
        *runtime.hud.lock().unwrap() = Some(original);
        Ok(())
    } else {
        let original = *runtime.hud.lock().unwrap();
        if let Some(original) = original {
            restore(&main, original)?;
            runtime.hud.lock().unwrap().take();
        }
        Ok(())
    }
}

fn restore(main: &tauri::WebviewWindow, original: HudWindowState) -> Result<(), String> {
    let mut error = None;
    macro_rules! restore {
        ($operation:expr) => {
            if let Err(value) = $operation {
                error.get_or_insert_with(|| value.to_string());
            }
        };
    }
    restore!(main.set_ignore_cursor_events(false));
    restore!(main.set_focusable(true));
    restore!(main.set_decorations(original.decorated));
    restore!(main.set_resizable(original.resizable));
    restore!(main.set_always_on_top(original.always_on_top));
    restore!(main.set_size(original.size));
    restore!(main.set_position(original.position));
    restore!(main.show());
    error.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::{clamp_position_in_area, needs_transition};
    use tauri::{PhysicalPosition, PhysicalSize};
    #[test]
    fn repeated_enter_and_exit_are_idempotent() {
        assert!(needs_transition(true, false));
        assert!(!needs_transition(true, true));
        assert!(needs_transition(false, true));
        assert!(!needs_transition(false, false));
    }
    #[test]
    fn clamps_hud_to_monitor_work_area() {
        let p = clamp_position_in_area(
            PhysicalPosition::new(1900, 1100),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1080),
            220,
            36,
        );
        assert_eq!(p, PhysicalPosition::new(1700, 1044));
        let p = clamp_position_in_area(
            PhysicalPosition::new(-20, -10),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1080),
            220,
            36,
        );
        assert_eq!(p, PhysicalPosition::new(0, 0));
    }
}
