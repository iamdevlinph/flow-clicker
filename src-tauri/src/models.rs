use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    pub title: Option<String>,
    pub left: Option<i32>,
    pub top: Option<i32>,
    pub right: Option<i32>,
    pub bottom: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedClick {
    pub screen_x: i32,
    pub screen_y: i32,
    pub relative_x: Option<i32>,
    pub relative_y: Option<i32>,
    pub window_title: Option<String>,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FlowAction {
    Click {
        id: String,
        name: String,
        screen_x: i32,
        screen_y: i32,
        relative_x: Option<i32>,
        relative_y: Option<i32>,
        window_title: Option<String>,
        #[serde(default)]
        delay_ms: u64,
    },
    Delay {
        id: String,
        name: String,
        delay_ms: u64,
    },
}

impl FlowAction {
    pub fn id(&self) -> &str {
        match self {
            FlowAction::Click { id, .. } | FlowAction::Delay { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClickRef<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub screen_x: i32,
    pub screen_y: i32,
    pub relative_x: Option<i32>,
    pub relative_y: Option<i32>,
    pub window_title: Option<&'a str>,
    pub delay_ms: u64,
}

impl FlowAction {
    pub fn as_click(&self) -> Option<ClickRef<'_>> {
        match self {
            FlowAction::Click { id, name, screen_x, screen_y, relative_x, relative_y, window_title, delay_ms } => Some(ClickRef {
                id, name, screen_x: *screen_x, screen_y: *screen_y, relative_x: *relative_x, relative_y: *relative_y, window_title: window_title.as_deref(), delay_ms: *delay_ms,
            }),
            FlowAction::Delay { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackOptions {
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_repeat_mode")]
    pub repeat_mode: String,
    #[serde(default = "default_repeat_value")]
    pub repeat_value: u64,
    #[serde(default = "default_repeat_unit")]
    pub repeat_unit: String,
    #[serde(default = "default_settle")]
    pub settle_ms: u64,
    #[serde(default = "default_hold")]
    pub hold_ms: u64,
    #[serde(default)]
    pub restore_cursor: bool,
    #[serde(default = "default_focus_target")]
    pub focus_target_window: bool,
}

fn default_speed() -> f64 { 1.0 }
fn default_repeat_mode() -> String { "cycles".into() }
fn default_repeat_value() -> u64 { 1 }
fn default_repeat_unit() -> String { "seconds".into() }
fn default_settle() -> u64 { 12 }
fn default_hold() -> u64 { 30 }
fn default_focus_target() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPoint {
    pub action_id: String,
    pub label: String,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPayload {
    pub points: Vec<OverlayPoint>,
    pub interactive: bool,
    pub origin_x: i32,
    pub origin_y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMove {
    pub action_id: String,
    pub screen_x: i32,
    pub screen_y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub physical_mouse_supported: bool,
    pub global_recording_supported: bool,
    pub window_relative_supported: bool,
    pub accessibility_note: Option<String>,
}
