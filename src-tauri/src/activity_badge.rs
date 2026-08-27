use tauri::{image::Image, AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Activity {
    Idle,
    Playing,
    Recording,
}

impl Activity {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "idle" => Ok(Self::Idle),
            "playing" => Ok(Self::Playing),
            "recording" => Ok(Self::Recording),
            _ => Err("Invalid activity badge".into()),
        }
    }
}

fn mark(activity: Activity, size: u32) -> Image<'static> {
    let mut rgba = vec![0; (size * size * 4) as usize];
    let center = size as i64 / 2;
    let radius = size as i64 * 2 / 5;
    let color = if activity == Activity::Recording {
        [255, 110, 127, 255]
    } else {
        [85, 213, 154, 255]
    };
    for y in 0..size {
        for x in 0..size {
            let dx = x as i64 - center;
            let dy = y as i64 - center;
            let marked = if activity == Activity::Recording {
                dx * dx + dy * dy <= radius * radius
            } else {
                dx >= -radius && dx <= radius / 2 && dy.abs() <= (radius / 2 - dx) / 2
            };
            if marked {
                rgba[((y * size + x) * 4) as usize..((y * size + x) * 4 + 4) as usize]
                    .copy_from_slice(&color);
            }
        }
    }
    Image::new_owned(rgba, size, size)
}

fn badged_icon(activity: Activity) -> Result<Image<'static>, String> {
    let base = Image::from_bytes(include_bytes!("../icons/icon.png")).map_err(|e| e.to_string())?;
    if activity == Activity::Idle {
        return Ok(base);
    }
    let badge = mark(activity, base.width() / 2);
    let mut rgba = base.rgba().to_vec();
    let offset_x = base.width() - badge.width();
    let offset_y = base.height() - badge.height();
    for y in 0..badge.height() {
        for x in 0..badge.width() {
            let source = ((y * badge.width() + x) * 4) as usize;
            if badge.rgba()[source + 3] != 0 {
                let target = (((y + offset_y) * base.width() + x + offset_x) * 4) as usize;
                rgba[target..target + 4].copy_from_slice(&badge.rgba()[source..source + 4]);
            }
        }
    }
    Ok(Image::new_owned(rgba, base.width(), base.height()))
}

pub fn set(app: &AppHandle, value: &str) -> Result<(), String> {
    let activity = Activity::parse(value)?;
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    #[cfg(target_os = "windows")]
    return main
        .set_overlay_icon((activity != Activity::Idle).then(|| mark(activity, 32)))
        .map_err(|e| e.to_string());
    #[cfg(target_os = "macos")]
    return main
        .set_badge_label(match activity {
            Activity::Idle => None,
            Activity::Playing => Some("▶".into()),
            Activity::Recording => Some("●".into()),
        })
        .map_err(|e| e.to_string());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    main.set_icon(badged_icon(activity)?)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{badged_icon, mark, Activity};

    #[test]
    fn validates_activity_and_loads_assets() {
        for value in ["idle", "playing", "recording"] {
            let activity = Activity::parse(value).unwrap();
            assert!(badged_icon(activity).unwrap().width() > 0);
            assert_eq!(mark(activity, 32).width(), 32);
        }
        assert!(Activity::parse("paused").is_err());
    }

    #[test]
    fn play_mark_points_right() {
        let image = mark(Activity::Playing, 32);
        let opaque = |x: u32| {
            (0..image.height())
                .filter(|y| image.rgba()[((y * image.width() + x) * 4 + 3) as usize] != 0)
                .count()
        };
        assert!(opaque(8) > opaque(24));
    }
}
