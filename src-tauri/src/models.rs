use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    pub title: Option<String>,
    pub executable_path: Option<String>,
    pub class_name: Option<String>,
    pub window_handle: Option<i64>,
    pub left: Option<i32>,
    pub top: Option<i32>,
    pub right: Option<i32>,
    pub bottom: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowTarget {
    pub executable_path: String,
    pub class_name: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedClick {
    #[serde(default)]
    pub button: ClickButton,
    pub screen_x: i32,
    pub screen_y: i32,
    pub relative_x: Option<i32>,
    pub relative_y: Option<i32>,
    pub window_title: Option<String>,
    pub executable_path: Option<String>,
    pub class_name: Option<String>,
    pub window_handle: Option<i64>,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ClickButton {
    #[default]
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FlowAction {
    Click {
        id: String,
        name: String,
        #[serde(default)]
        button: ClickButton,
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
    Group {
        id: String,
        name: String,
        repeat_count: u64,
        actions: Vec<FlowAction>,
    },
}

#[derive(Debug, Clone)]
pub struct ClickRef<'a> {
    pub id: &'a str,
    pub screen_x: i32,
    pub screen_y: i32,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub relative_x: Option<i32>,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub relative_y: Option<i32>,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub window_title: Option<&'a str>,
}

impl FlowAction {
    pub fn as_click(&self) -> Option<ClickRef<'_>> {
        match self {
            FlowAction::Click {
                id,
                screen_x,
                screen_y,
                relative_x,
                relative_y,
                window_title,
                ..
            } => Some(ClickRef {
                id,
                screen_x: *screen_x,
                screen_y: *screen_y,
                relative_x: *relative_x,
                relative_y: *relative_y,
                window_title: window_title.as_deref(),
            }),
            FlowAction::Delay { .. } | FlowAction::Group { .. } => None,
        }
    }

    pub fn validate(&self, nested: bool) -> Result<(), String> {
        if let FlowAction::Group {
            actions,
            repeat_count,
            ..
        } = self
        {
            if nested {
                return Err("Nested action groups are not supported".into());
            }
            if *repeat_count == 0 {
                return Err("Group repeatCount must be positive".into());
            }
            if actions.is_empty() {
                return Err("Action groups cannot be empty".into());
            }
            if actions
                .iter()
                .any(|a| matches!(a, FlowAction::Group { .. }))
            {
                return Err("Nested action groups are not supported".into());
            }
            for action in actions {
                action.validate(true)?;
            }
        }
        Ok(())
    }

    pub fn click_count(&self) -> u64 {
        match self {
            FlowAction::Click { .. } => 1,
            FlowAction::Delay { .. } => 0,
            FlowAction::Group {
                actions,
                repeat_count,
                ..
            } => actions.iter().map(Self::click_count).sum::<u64>() * *repeat_count,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    Cycles,
    Clicks,
    Duration,
    Continuous,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RepeatUnit {
    Seconds,
    Minutes,
    Hours,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackOptions {
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_repeat_mode")]
    pub repeat_mode: RepeatMode,
    #[serde(default = "default_repeat_value")]
    pub repeat_value: u64,
    #[serde(default = "default_repeat_unit")]
    pub repeat_unit: RepeatUnit,
    #[serde(default = "default_settle")]
    pub settle_ms: u64,
    #[serde(default = "default_hold")]
    pub hold_ms: u64,
    #[serde(default)]
    pub restore_cursor: bool,
    #[serde(default = "default_focus_target")]
    pub focus_target_window: bool,
    #[serde(default)]
    pub until_time: Option<u64>,
}

fn default_speed() -> f64 {
    1.0
}
fn default_repeat_mode() -> RepeatMode {
    RepeatMode::Cycles
}
fn default_repeat_value() -> u64 {
    1
}
fn default_repeat_unit() -> RepeatUnit {
    RepeatUnit::Seconds
}
fn default_settle() -> u64 {
    12
}
fn default_hold() -> u64 {
    30
}
fn default_focus_target() -> bool {
    true
}

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

#[cfg(test)]
mod tests {
    use super::{ClickButton, FlowAction, PlaybackOptions, RepeatMode, RepeatUnit};

    #[test]
    fn deserializes_frontend_flow_actions() {
        let actions: Vec<FlowAction> = serde_json::from_str(
            r#"[
                {"type":"click","id":"click-1","name":"Click","screenX":100,"screenY":200,"relativeX":10,"relativeY":20,"windowTitle":"Target","delayMs":250},
                {"type":"delay","id":"delay-1","name":"Wait","delayMs":500}
            ]"#,
        )
        .unwrap();

        assert_eq!(actions.len(), 2);
        assert!(matches!(
            &actions[0],
            FlowAction::Click { screen_x: 100, screen_y: 200, relative_x: Some(10), relative_y: Some(20), window_title: Some(title), delay_ms: 250, .. }
                if title == "Target"
        ));
        assert!(matches!(
            &actions[1],
            FlowAction::Delay { delay_ms: 500, .. }
        ));
    }

    #[test]
    fn defaults_legacy_clicks_and_serializes_right_clicks() {
        let legacy: FlowAction = serde_json::from_str(
            r#"{"type":"click","id":"c","name":"C","screenX":1,"screenY":2,"delayMs":0}"#,
        )
        .unwrap();
        assert!(matches!(
            legacy,
            FlowAction::Click {
                button: ClickButton::Left,
                ..
            }
        ));
        let right = FlowAction::Click {
            id: "c".into(),
            name: "C".into(),
            button: ClickButton::Right,
            screen_x: 1,
            screen_y: 2,
            relative_x: None,
            relative_y: None,
            window_title: None,
            delay_ms: 0,
        };
        assert_eq!(serde_json::to_value(right).unwrap()["button"], "right");
        assert!(serde_json::from_str::<FlowAction>(
            r#"{"type":"click","id":"c","name":"C","screenX":1,"screenY":2,"delayMs":0,"button":"middle"}"#,
        ).is_err());
    }

    #[test]
    fn validates_groups_and_counts_repeated_clicks() {
        let group = FlowAction::Group {
            id: "g".into(),
            name: "G".into(),
            repeat_count: 2,
            actions: vec![FlowAction::Click {
                id: "c".into(),
                name: "C".into(),
                screen_x: 1,
                screen_y: 2,
                relative_x: None,
                relative_y: None,
                window_title: None,
                button: ClickButton::Left,
                delay_ms: 0,
            }],
        };
        assert_eq!(group.click_count(), 2);
        assert!(group.validate(false).is_ok());
        assert!(FlowAction::Group {
            id: "e".into(),
            name: "E".into(),
            repeat_count: 1,
            actions: vec![]
        }
        .validate(false)
        .is_err());
    }

    #[test]
    fn deserializes_typed_playback_options() {
        let options: PlaybackOptions =
            serde_json::from_str(r#"{"repeatMode":"duration","repeatUnit":"minutes"}"#).unwrap();
        assert_eq!(options.repeat_mode, RepeatMode::Duration);
        assert_eq!(options.repeat_unit, RepeatUnit::Minutes);
    }
}
