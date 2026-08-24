use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Size, WebviewWindow};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorSize {
    pub width: f64,
    pub height: f64,
}

fn valid_size(size: EditorSize) -> bool {
    size.width.is_finite() && size.height.is_finite() && size.width > 0.0 && size.height > 0.0
}

fn logical_size(physical: (u32, u32), scale_factor: f64) -> Option<EditorSize> {
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return None;
    }
    let size = EditorSize {
        width: f64::from(physical.0) / scale_factor,
        height: f64::from(physical.1) / scale_factor,
    };
    valid_size(size).then_some(size)
}

pub fn show(window: &WebviewWindow, saved_size: Option<EditorSize>) -> Result<(), String> {
    if let Some(size) = saved_size.filter(|size| valid_size(*size)) {
        let _ = window.set_size(Size::Logical(LogicalSize::new(size.width, size.height)));
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn hide(window: &WebviewWindow) -> Result<Option<EditorSize>, String> {
    let size = if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false)
    {
        None
    } else {
        window.inner_size().ok().and_then(|physical| {
            window
                .scale_factor()
                .ok()
                .and_then(|scale| logical_size((physical.width, physical.height), scale))
        })
    };
    window.hide().map_err(|error| error.to_string())?;
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::{logical_size, valid_size, EditorSize};

    #[test]
    fn converts_physical_size_to_logical_pixels() {
        assert_eq!(
            logical_size((1600, 1000), 2.0),
            Some(EditorSize {
                width: 800.0,
                height: 500.0
            })
        );
    }

    #[test]
    fn rejects_invalid_sizes() {
        for size in [
            EditorSize {
                width: 0.0,
                height: 1.0,
            },
            EditorSize {
                width: 1.0,
                height: -1.0,
            },
            EditorSize {
                width: f64::NAN,
                height: 1.0,
            },
            EditorSize {
                width: 1.0,
                height: f64::INFINITY,
            },
        ] {
            assert!(!valid_size(size));
        }
        assert!(logical_size((100, 100), 0.0).is_none());
    }
}
