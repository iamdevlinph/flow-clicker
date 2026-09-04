use crate::contracts::{valid_click, Click, Viewport};

pub fn flatten(value: &str) -> Result<(Vec<Click>, u64), String> {
    fn collect(
        value: &serde_json::Value,
        out: &mut Vec<Click>,
        pending: &mut u64,
    ) -> Result<(), String> {
        match value.get("type").and_then(|v| v.as_str()) {
            Some("click") => {
                if out.len() >= 10_000 {
                    return Err("Flow exceeds 10000 browser clicks".into());
                }
                let click = Click {
                    action_id: value.get("id").and_then(|v| v.as_str()).map(str::to_owned),
                    x: value
                        .get("x")
                        .or_else(|| value.get("screenX"))
                        .and_then(|v| v.as_f64())
                        .ok_or("Browser click x is missing")?,
                    y: value
                        .get("y")
                        .or_else(|| value.get("screenY"))
                        .and_then(|v| v.as_f64())
                        .ok_or("Browser click y is missing")?,
                    viewport: Viewport {
                        width: value
                            .get("viewportWidth")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0),
                        height: value
                            .get("viewportHeight")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0),
                    },
                    button: match value
                        .get("button")
                        .and_then(|v| v.as_str())
                        .unwrap_or("left")
                    {
                        "left" | "right" => value
                            .get("button")
                            .and_then(|v| v.as_str())
                            .unwrap_or("left")
                            .into(),
                        _ => return Err("Unsupported browser click button".into()),
                    },
                    delay_ms: value
                        .get("delayMs")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                        .saturating_add(*pending),
                };
                *pending = 0;
                valid_click(&click)?;
                out.push(click);
            }
            Some("delay") => {
                *pending = pending
                    .saturating_add(value.get("delayMs").and_then(|v| v.as_u64()).unwrap_or(0))
            }
            Some("group") => {
                let actions = value
                    .get("actions")
                    .and_then(|v| v.as_array())
                    .ok_or("Browser action group is invalid")?;
                let repeat_count = value
                    .get("repeatCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1);
                if repeat_count == 0 {
                    return Err("Group repeatCount must be positive".into());
                }
                if repeat_count > 10_000 {
                    return Err("Group repeatCount exceeds 10000".into());
                }
                for _ in 0..repeat_count {
                    actions.iter().try_for_each(|v| collect(v, out, pending))?;
                }
            }
            _ => return Err("Unsupported browser action".into()),
        }
        Ok(())
    }
    let values: Vec<serde_json::Value> =
        serde_json::from_str(value).map_err(|e| format!("Invalid actions: {e}"))?;
    let mut out = Vec::new();
    let mut pending = 0;
    values
        .iter()
        .try_for_each(|v| collect(v, &mut out, &mut pending))?;
    if out.is_empty() {
        return Err("Flow has no browser clicks".into());
    }
    Ok((out, pending))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flattens_mixed_clicks_in_order() {
        let (clicks, trailing) = flatten(r#"[{"type":"delay","delayMs":4},{"type":"click","id":"a","x":1,"y":2,"viewportWidth":10,"viewportHeight":10,"button":"right"},{"type":"group","repeatCount":2,"actions":[{"type":"click","id":"b","x":2,"y":2,"viewportWidth":10,"viewportHeight":10,"button":"left"},{"type":"click","id":"c","x":3,"y":2,"viewportWidth":10,"viewportHeight":10,"button":"right"}]},{"type":"click","id":"d","x":4,"y":2,"viewportWidth":10,"viewportHeight":10,"button":"left"},{"type":"delay","delayMs":7}]"#).unwrap();
        assert_eq!(
            clicks
                .iter()
                .map(|click| click.action_id.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["a", "b", "c", "b", "c", "d"]
        );
        assert_eq!(
            clicks
                .iter()
                .map(|click| click.button.as_str())
                .collect::<Vec<_>>(),
            ["right", "left", "right", "left", "right", "left"]
        );
        assert_eq!(clicks[0].delay_ms, 4);
        assert_eq!(trailing, 7);
        assert!(flatten(r#"[{"type":"group","repeatCount":10001,"actions":[{"type":"click","x":1,"y":1,"viewportWidth":10,"viewportHeight":10}]}]"#).is_err());
        assert!(flatten(r#"[{"type":"group","repeatCount":10000,"actions":[{"type":"click","x":1,"y":1,"viewportWidth":10,"viewportHeight":10},{"type":"click","x":2,"y":2,"viewportWidth":10,"viewportHeight":10}]}]"#).is_err());
    }
}
